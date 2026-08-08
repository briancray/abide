// The one line you are typing, and the ghost of what it could be.
//
// Its own editor rather than `node:readline` because of the ghost: a suggestion has to be drawn AFTER
// the cursor and then taken back if you keep typing, which means owning the repaint. Owning the
// repaint is most of a line editor, and the rest — history, the cursor keys, the kills — is the part
// that would otherwise be missing the moment we drew one character ourselves.
//
// Nothing here knows what a completion IS, what a line MEANS, or where the text goes: the hooks
// answer all three. That is what lets a test drive the whole editor with a string of keystrokes and
// read back what would have been painted, with no terminal anywhere.

import { DIM, OFF } from './paint.ts'

export interface EditorHooks {
    /** Where the painted line goes. */
    write(text: string): void
    /**
     * What would complete the word being typed — the REMAINDER, not the whole word, and `''` for
     * nothing. Asked on every repaint, so it is the caller's business to make it cheap.
     */
    complete(prefix: string): string
    /** A finished line. Called once per Enter, including for an empty one. */
    onLine(line: string): void
    /** Ctrl-C — abandon what is typed. */
    onInterrupt(): void
    /** Ctrl-D on an empty line. */
    onEnd(): void
}

/** The identifier being typed, which is the only thing a completion is offered for. */
const WORD = /[A-Za-z_$][\w$]*$/

export class LineEditor {
    /** What is painted before the buffer. The REPL swaps it for the continuation form. */
    prompt = '> '

    private buffer = ''
    private cursor = 0
    private ghost = ''
    private readonly history: string[] = []
    /** Where in the history we are, or `-1` for the line actually being typed. */
    private browsing = -1
    /** The live line, parked while the history is being walked, and put back on the way out. */
    private parked = ''

    /**
     * `ghosts` is off wherever color is: an undimmed suggestion is indistinguishable from what you
     * typed, and a line editor that lies about which characters are yours is worse than one with no
     * suggestions at all.
     */
    constructor(
        private readonly hooks: EditorHooks,
        private readonly ghosts: boolean,
    ) {}

    /** A chunk of raw input. One chunk may hold a paste, an escape sequence, or one keystroke. */
    feed(text: string): void {
        for (let i = 0; i < text.length; i++) {
            const ch = text[i] as string
            if (ch === '\x1b') {
                i += this.escaped(text, i)
                continue
            }
            if (ch === '\r' || ch === '\n') {
                this.submit()
                continue
            }
            if (ch === '\x7f' || ch === '\b') {
                this.backspace()
                continue
            }
            if (ch === '\t') {
                this.take()
                continue
            }
            if (ch === '\x03') {
                this.abandon()
                continue
            }
            if (ch === '\x04') {
                if (this.buffer === '') {
                    this.hooks.onEnd()
                    return
                }
                this.delete()
                continue
            }
            if (ch === '\x01') {
                this.cursor = 0
                this.refresh()
                continue
            }
            if (ch === '\x05') {
                this.cursor = this.buffer.length
                this.refresh()
                continue
            }
            if (ch === '\x15') {
                this.set('', 0)
                continue
            }
            // Anything else printable. A control character we have no meaning for is dropped rather
            // than inserted, or a stray escape would end up in the source being evaluated.
            const code = ch.charCodeAt(0)
            if (code < 0x20) continue
            this.set(this.buffer.slice(0, this.cursor) + ch + this.buffer.slice(this.cursor), this.cursor + 1)
        }
    }

    /** Repaint. Public because the REPL calls it after printing a result, to put the line back. */
    refresh(): void {
        // The ghost is asked for only at the END of the line: drawn mid-buffer it would be a
        // suggestion for text that already has more after it, which is a suggestion about nothing.
        this.ghost = this.ghosts && this.cursor === this.buffer.length ? this.hooks.complete(this.word()) : ''
        const shown = this.ghost === '' ? '' : `${DIM}${this.ghost}${OFF}`
        // Column 0, wipe, paint, then back to column 0 and out to where the cursor actually is —
        // absolute rather than relative, so a repaint cannot drift out of step with the terminal.
        this.hooks.write(
            `\r\x1b[2K${this.prompt}${this.buffer}${shown}\r\x1b[${this.prompt.length + this.cursor}C`,
        )
    }

    private remember(line: string): void {
        if (line === '' || this.history[this.history.length - 1] === line) return
        this.history.push(line)
    }

    /** Only asked when the cursor is at the end, so the buffer IS the text before it. */
    private word(): string {
        const found = WORD.exec(this.buffer)
        if (found === null) return ''
        // A MEMBER is not a name in scope: `rows.a` completing to `rows.atob` would be a suggestion
        // about the global object where the value being reached into is the only thing that could
        // answer — and asking it would mean evaluating the receiver, which a keystroke must not do.
        return this.buffer[this.buffer.length - found[0].length - 1] === '.' ? '' : found[0]
    }

    private set(buffer: string, cursor: number): void {
        this.buffer = buffer
        this.cursor = cursor
        this.refresh()
    }

    /**
     * Scroll the line away and start an empty one. Both ways out of a line — entering it and
     * abandoning it — are this, so the two cannot drift on what a finished line leaves behind.
     *
     * Repainted WITHOUT the ghost: what scrolls away has to be what was actually entered, or the
     * transcript above the prompt shows text nobody typed.
     */
    private release(): string {
        const line = this.buffer
        this.ghost = ''
        this.hooks.write(`\r\x1b[2K${this.prompt}${line}\n`)
        this.buffer = ''
        this.cursor = 0
        this.browsing = -1
        return line
    }

    private submit(): void {
        const line = this.release()
        this.remember(line)
        this.hooks.onLine(line)
    }

    private abandon(): void {
        this.release()
        this.hooks.onInterrupt()
    }

    private backspace(): void {
        if (this.cursor === 0) return
        this.set(this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor), this.cursor - 1)
    }

    private delete(): void {
        if (this.cursor === this.buffer.length) return
        this.set(this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1), this.cursor)
    }

    /** Accept the ghost. Tab, or a right arrow with nothing to its right. */
    private take(): void {
        if (this.ghost === '') return
        this.set(this.buffer + this.ghost, this.buffer.length + this.ghost.length)
    }

    private walk(by: number): void {
        if (this.history.length === 0) return
        if (this.browsing === -1) {
            if (by > 0) return
            this.parked = this.buffer
            this.browsing = this.history.length
        }
        const at = this.browsing + by
        if (at >= this.history.length) {
            this.browsing = -1
            this.set(this.parked, this.parked.length)
            return
        }
        if (at < 0) return
        this.browsing = at
        const held = this.history[at] as string
        this.set(held, held.length)
    }

    /** An escape sequence at `at`. Returns how many EXTRA characters it consumed. */
    private escaped(text: string, at: number): number {
        // `\x1bO…` is the same arrow from a terminal in application-cursor mode, so both are read.
        const second = text[at + 1]
        if (second !== '[' && second !== 'O') return 0
        const third = text[at + 2]
        if (third === undefined) return 1
        if (third === 'A') this.walk(-1)
        else if (third === 'B') this.walk(1)
        else if (third === 'C') {
            if (this.cursor === this.buffer.length) this.take()
            else this.set(this.buffer, this.cursor + 1)
        } else if (third === 'D') {
            if (this.cursor > 0) this.set(this.buffer, this.cursor - 1)
        } else if (third === 'H') this.set(this.buffer, 0)
        else if (third === 'F') this.set(this.buffer, this.buffer.length)
        else if (third === '3' && text[at + 3] === '~') {
            this.delete()
            return 3
        }
        return 2
    }
}

/**
 * The best completion for what is being typed, as the REMAINDER of it.
 *
 * Shortest wins, then alphabetical, and both rules are there for the same reason: a suggestion that
 * changed as the candidate list was reordered would be one nobody could learn. An exact match
 * suggests nothing — there is nothing left to add, and a ghost of `''` is how that is said.
 */
export function suggest(prefix: string, candidates: string[]): string {
    if (prefix === '') return ''
    let best = ''
    for (const candidate of candidates) {
        if (candidate.length <= prefix.length || !candidate.startsWith(prefix)) continue
        if (
            best === '' ||
            candidate.length < best.length ||
            (candidate.length === best.length && candidate < best)
        ) {
            best = candidate
        }
    }
    return best === '' ? '' : best.slice(prefix.length)
}
