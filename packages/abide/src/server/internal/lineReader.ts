import { createInterface, type Interface } from 'node:readline'
import { colourEnabled } from '../../shared/internal/colourEnabled.ts'
import { readLines } from '../../shared/internal/readLines.ts'

// lineReader({ input, tty, write }) — one line of input at a time, under a prompt.
//
// The REPL used to read raw bytes off the stream and split on `\n`, which is correct for a pipe and
// wrong at a terminal: a terminal in raw mode delivers the KEYSTROKES, so backspace arrived as a
// literal `\x7f` in the buffer (you saw `cacha^H^H` and sent it to the server), an arrow key arrived
// as `\x1b[A`, and ctrl-c reached the process handler that `installShutdownHandlers` registered — so
// it tore the whole binary down instead of abandoning the half-typed line.
//
// Two adapters, because the two cases genuinely differ. A pipe has no cursor to move and no history
// to recall, and must stay byte-identical to what it did before (a script doing `printf 'greet\n' |
// app` is a supported way to drive this). A terminal wants line editing, history, and ctrl-c that
// means "forget this line".
//
// `read` returns undefined when the session is over — EOF on a pipe, ctrl-d at a terminal, or ctrl-c
// on an ALREADY-EMPTY line. That last one is what keeps `serve`'s "ctrl-c stops it" true: press it
// once with something typed and you lose the line, press it at a bare prompt and you leave.

// `history` is real (readline maintains it, and the up arrow reads it) but absent from Node's public
// `Interface` type, so trimming a field answer back out needs this view. Asserted in
// `lineReader.test.ts` rather than assumed — if a Bun release drops it, that test fails rather than
// history silently filling with values.
type WithHistory = Interface & { history: string[] }

// What TAB offers for the line typed so far. Per-READ rather than per-reader: the main prompt
// completes command lines, a field prompt completes that field's enum values, and they are different
// questions asked of the same terminal.
export type LineCompleter = (line: string) => {
    candidates: string[]
    partial: string
    // A display-only signature for this position. Painted like a suggestion but NOT acceptable —
    // `→` on it would insert `--name <string>` literally, which is not a command line.
    hint?: string | undefined
}

export interface LineReader {
    read(
        prompt: string,
        options?: {
            // `history: false` for a schema field prompt — an answer typed into `title:` is not a
            // command, and recalling it later with the up arrow would put a bare value where a
            // command name goes.
            history?: boolean | undefined
            complete?: LineCompleter | undefined
        },
    ): Promise<string | undefined>
    // Divert ctrl-c to `handler` for the duration of a long-running command, and return the undo. A
    // streaming command (`logs`) needs ctrl-c to mean "stop this" rather than "leave the session" —
    // and only the reader can express that, because raw mode means the kernel never raises SIGINT and
    // readline is the sole source of the keypress. Absent a diversion the behaviour is unchanged.
    interceptInterrupt(handler: () => void): () => void
    close(): void
}

// Line framing is `readLines` (shared) — the pipe adapter only decides what to DO with a line. Bun's
// `prompt()` would be shorter than either but blocks the event loop, and this process may also be
// hosting the server the next call goes to.

export function lineReader(options: {
    input: ReadableStream<Uint8Array>
    // A person is typing at a terminal. False for a pipe, and false in tests, which drive the pipe
    // adapter — the terminal adapter needs a real tty to set raw mode, so it is exercised by
    // `lineReader.test.ts` against a PassThrough with `terminal` forced on instead.
    tty: boolean
    write(text: string): void
    // Node streams for the terminal adapter. Defaulted to the process's own, and injectable so the
    // editing behaviour is testable without a terminal.
    terminalInput?: NodeJS.ReadableStream
    terminalOutput?: NodeJS.WritableStream
}): LineReader {
    if (!options.tty) {
        const lines = readLines(options.input)
        return {
            // A pipe has no TAB, so `complete` is accepted and ignored rather than made optional on
            // one adapter and required on the other.
            async read(prompt: string): Promise<string | undefined> {
                options.write(prompt)
                const next = await lines.next()
                return next.done === true ? undefined : next.value
            },
            // A pipe has no ctrl-c to divert — SIGINT reaches the process itself, where the shutdown
            // handlers own it. Accepted and ignored, for the same reason `complete` is.
            interceptInterrupt(): () => void {
                return (): void => {}
            },
            close(): void {
                void lines.return(undefined)
            },
        }
    }

    const output = options.terminalOutput ?? process.stdout
    const terminalInput = options.terminalInput ?? process.stdin
    // readline fixes its completer at construction, but WHAT completes changes per prompt — so the
    // interface delegates to whatever the outstanding `read` installed.
    let completer: LineCompleter | undefined
    const rl = createInterface({
        input: terminalInput,
        output,
        terminal: true,
        historySize: 200,
        completer: (line: string): [string[], string] => {
            const completion = completer?.(line)
            // readline substitutes `partial` with the single hit, or lists them and completes the
            // common prefix. Handing back the WHOLE line as the partial when there is nothing to
            // offer is what stops TAB from eating the word.
            return completion === undefined
                ? [[], line]
                : [completion.candidates, completion.partial]
        },
    }) as WithHistory

    // ── Inline suggestion ("ghost text") ────────────────────────────────────────────────────────
    // The best candidate for what you have typed, rendered DIM after the cursor and not part of the
    // line. Right-arrow (or ctrl-e) at the end of the line accepts it; typing on ignores it. readline
    // has no concept of this, so it is drawn by hand around readline's own redraw:
    //
    //   • readline repaints the whole line on every keypress, so the suggestion is (re)drawn AFTER
    //     that repaint, on a `setImmediate`;
    //   • it is erased on the leading edge of the next keypress (`prependListener`, so this runs
    //     BEFORE readline's own handler) — which is what keeps it off the line you actually submit,
    //     since Enter would otherwise scroll away with the suggestion still painted on it;
    //   • it is only offered with the cursor at the END of the line, because a suggestion drawn
    //     mid-edit would sit between the cursor and the text you are editing around.
    //
    // Gated on the SAME colour rule the REPL's styling uses (NO_COLOR / FORCE_COLOR / is-a-terminal),
    // rather than a private NO_COLOR check: undimmed ghost text is indistinguishable from what you
    // typed, so "may I dim this" and "may I suggest at all" are one question.
    const suggestionsEnabled = colourEnabled(true)
    // The painted text, and whether `→` may take it. A completion is acceptable; a signature hint is
    // not — the two look alike on screen deliberately (both are "what could come next"), and only
    // this flag separates them.
    // What is PAINTED and what `→` inserts are not always the same text: at a bare flag position the
    // paint is the whole signature (`--name <string> --pinned`) while the accept is just the first
    // flag (`--name`). You accept the flag, not the placeholder.
    let suggestion = ''
    let accepts = ''
    const eraseSuggestion = (): void => {
        accepts = ''
        if (suggestion.length === 0) return
        // The cursor sits exactly where the suggestion starts, so erase-to-end-of-line clears it and
        // nothing else.
        output.write('\u001b[0K')
        suggestion = ''
    }
    const drawSuggestion = (): void => {
        suggestion = ''
        accepts = ''
        if (!suggestionsEnabled || completer === undefined) return
        // `rl.line` is the buffer; `rl.cursor` its offset. Nothing to suggest on an empty line, and
        // nothing safe to suggest with the cursor parked mid-line.
        if (rl.line.length === 0 || rl.cursor !== rl.line.length) return
        const { candidates, partial, hint } = completer(rl.line)
        const best = candidates[0]
        // What a completion would append. Also what `→` takes in BOTH branches below, since with an
        // empty partial the remainder is the whole candidate.
        const remainder =
            best !== undefined && best !== partial && best.startsWith(partial)
                ? best.slice(partial.length)
                : ''
        if (partial.length === 0 && hint !== undefined && hint.length > 0) {
            // Nothing typed at this position, so the useful paint is the SIGNATURE — a single
            // alphabetically-first candidate answers a question you did not ask. `→` still takes the
            // flag itself when there is one.
            suggestion = hint
            accepts = remainder
        } else {
            suggestion = remainder
            accepts = remainder
        }
        if (suggestion.length === 0) return
        // Dim, then restore, then walk the cursor back over it — the text is painted but the cursor
        // stays where the typing is.
        output.write(`\u001b[2m${suggestion}\u001b[0m\u001b[${suggestion.length}D`)
    }

    // The two stdin shapes (`process.stdin` and an injected Readable) have incompatible overload sets
    // for `on`/`prependListener`; keypress is a plain emitter event either way.
    const keypresses = terminalInput as NodeJS.EventEmitter
    keypresses.prependListener(
        'keypress',
        (_text: string, key?: { name?: string; ctrl?: boolean }) => {
            // Read the flag BEFORE erasing (which clears it). A signature hint is painted like a
            // completion and is deliberately not takeable.
            const offered = accepts
            eraseSuggestion()
            if (offered.length === 0) return
            // Accept: right-arrow at the end of the line has nothing else to mean, and ctrl-e is the
            // conventional second spelling. Written on a `setImmediate` so readline has finished with the
            // keypress first — inserting into the buffer mid-dispatch corrupts its cursor accounting.
            const accepting =
                (key?.name === 'right' && !key.ctrl) || (key?.name === 'e' && key.ctrl === true)
            if (accepting && rl.cursor === rl.line.length) setImmediate(() => rl.write(offered))
        },
    )
    // Coalesced: a burst of keypresses (a paste, or anything writing faster than the event loop
    // drains) would otherwise queue one redraw per character and repaint the same suggestion N times.
    let drawScheduled = false
    keypresses.on('keypress', () => {
        if (drawScheduled) return
        drawScheduled = true
        setImmediate(() => {
            drawScheduled = false
            drawSuggestion()
        })
    })

    let closed = false
    let pending: ((line: string | undefined) => void) | undefined
    const settle = (line: string | undefined): void => {
        const resolve = pending
        pending = undefined
        resolve?.(line)
    }

    rl.on('line', (line: string) => settle(line))
    rl.on('close', () => {
        closed = true
        settle(undefined)
    })
    // Raw mode disables the terminal's own ISIG, so the kernel never raises SIGINT here and the
    // process-level handler is not involved at all — readline hands us the keypress instead, which is
    // the only reason cancelling a line is expressible.
    let onInterrupt: (() => void) | undefined
    rl.on('SIGINT', () => {
        // A command is running and asked to own ctrl-c (see `interceptInterrupt`). It stops; the
        // session does not.
        if (onInterrupt !== undefined) {
            onInterrupt()
            return
        }
        if (rl.line.length > 0) {
            // Erase the buffer (ctrl-u) and redraw, so the abandoned text scrolls away rather than
            // being silently resubmitted. `rl.prompt()` redraws whatever `read` last set, which is why
            // this uses setPrompt/prompt rather than `rl.question` — question owns a prompt readline
            // will not redraw for us.
            rl.write(null, { ctrl: true, name: 'u' })
            output.write('^C\n')
            rl.prompt()
            return
        }
        closed = true
        settle(undefined)
        rl.close()
    })

    return {
        read(
            prompt: string,
            readOptions?: { history?: boolean | undefined; complete?: LineCompleter | undefined },
        ): Promise<string | undefined> {
            if (closed) return Promise.resolve(undefined)
            completer = readOptions?.complete
            rl.setPrompt(prompt)
            const before = rl.history.length
            return new Promise<string | undefined>((resolve) => {
                pending = (line) => {
                    // readline records every submitted line; a field answer is trimmed back out here
                    // rather than by turning history off, because it must stay on for the next command.
                    if (readOptions?.history === false && rl.history.length > before)
                        rl.history.shift()
                    resolve(line)
                }
                rl.prompt()
            })
        },
        interceptInterrupt(handler: () => void): () => void {
            onInterrupt = handler
            // Compares identity before clearing, so an undo that runs late (a command that finished
            // after another already took over) cannot disarm someone else's interception.
            return (): void => {
                if (onInterrupt === handler) onInterrupt = undefined
            }
        },
        close(): void {
            closed = true
            rl.close()
        },
    }
}
