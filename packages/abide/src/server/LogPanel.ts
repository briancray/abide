import { useColor } from '#shared/log.ts'
import { paint } from '#shared/paint.ts'

const ESCAPE = '\x1b['
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const
/** The panel lines kept for a repaint — more than any terminal is tall. */
const LINES_KEPT = 1000

/**
 * The shell's terminal layout: a heading pinned at the top, the console tailed in a scrolling panel
 * under it, and the prompt pinned on the last row.
 *
 * EVERY CONSOLE LINE LANDS IN THE PANEL, the logger's among them (28.1 writes through the console),
 * so the prompt and whatever the user is half-way through typing stay put while the app logs.
 *
 * A SCROLL REGION: the terminal scrolls the panel's rows itself, and Enter on the last row, below the
 * region, moves nothing. After each write the cursor goes back to the last row and `redraw` puts the
 * prompt and the line being typed there — asked of whoever holds that line, rather than restored with
 * DECSC/DECRC, which some terminals clamp into the scroll region.
 *
 * ON THE ALTERNATE SCREEN, REPAINTED WHOLE ON A RESIZE, out of the lines kept. A terminal made taller
 * pulls its scrollback down into view, and one made narrower reflows what it holds, so a layout that
 * only redrew its own rows left every earlier copy of the heading standing beneath the new one. The
 * alternate screen has no scrollback to pull, and hands the shell's screen back as it was on close.
 */
export class LogPanel {
    #heading: string[]
    #hint: string
    /** What the divider says in place of `#hint` while the line being typed has something to say. */
    #signature: string | undefined = undefined
    #redraw: () => void
    #color = useColor()
    #rows = 0
    #columns = 0
    #top = 1
    #bottom = 1
    /** The next empty row while the panel fills from the top; past `#bottom` it scrolls. */
    #next = 1
    /** The panel's lines, newest last — trimmed back to `LINES_KEPT` once twice that. */
    #lines: string[] = []
    /** What Tab could complete to, laid over the panel's last rows until `hideCompletions`. */
    #completions: string[] = []
    #originals: Pick<Console, (typeof CONSOLE_METHODS)[number]>
    #closed = false
    #resize = (): void => this.#layout()
    #exit = (): void => this.close()

    constructor(heading: string, hint: string, redraw: () => void) {
        this.#heading = heading.replace(/\n+$/, '').split('\n')
        this.#hint = hint
        this.#redraw = redraw
        this.#originals = {
            log: console.log,
            info: console.info,
            warn: console.warn,
            error: console.error,
            debug: console.debug,
        }
        const write = (...args: unknown[]): void =>
            this.write(formatted(args, this.#color))
        for (const method of CONSOLE_METHODS) console[method] = write
        process.stdout.on('resize', this.#resize)
        // A signal ends the process through `stopOnSignalOrFault`, and a terminal left on the
        // alternate screen with a scroll region set is one the next command cannot use.
        process.on('exit', this.#exit)
        process.stdout.write(`${ESCAPE}?1049h`)
        this.#layout()
    }

    /** Writes text into the panel, above the prompt. */
    write(text: string): void {
        if (this.#closed) {
            this.#originals.log(text)
            return
        }
        let out = ''
        for (const line of text.split('\n')) {
            this.#lines.push(line)
            out += this.#placed(line)
        }
        if (this.#lines.length > LINES_KEPT * 2)
            this.#lines.splice(0, this.#lines.length - LINES_KEPT)
        // A line scrolled under the completions would carry them up the panel with it.
        if (this.#completions.length > 0) {
            this.#layout()
            return
        }
        process.stdout.write(out)
        this.prompt()
    }

    /** Lays `completions` over the panel's last rows, in columns, until `hideCompletions`. */
    showCompletions(completions: string[]): void {
        if (this.#closed) return
        this.#completions = completions
        this.#layout()
    }

    /** Empties the panel. */
    clear(): void {
        if (this.#closed) return
        this.#lines = []
        this.#completions = []
        this.#layout()
    }

    /** Takes the completions away, and paints the panel back under them. */
    hideCompletions(): void {
        if (this.#closed || this.#completions.length === 0) return
        this.#completions = []
        this.#layout()
    }

    /** Puts the cursor on the last row and has the prompt redrawn there. */
    prompt(): void {
        if (this.#closed) return
        process.stdout.write(`${ESCAPE}${this.#rows};1H`)
        this.#redraw()
    }

    /** Hands the terminal back as it was found: its own screen, the console its own again. */
    close(): void {
        if (this.#closed) return
        this.#closed = true
        Object.assign(console, this.#originals)
        process.stdout.off('resize', this.#resize)
        process.off('exit', this.#exit)
        process.stdout.write(`${ESCAPE}r${ESCAPE}?1049l`)
    }

    /** The escapes that write one line at the panel's next row, scrolling it once it is full. */
    #placed(line: string): string {
        if (this.#next > this.#bottom)
            return `${ESCAPE}${this.#bottom};1H\n${line}`
        const placed = `${ESCAPE}${this.#next};1H${line}`
        this.#next += this.#rowsOf(line)
        return placed
    }

    #rowsOf(line: string): number {
        return Math.max(1, Math.ceil(Bun.stringWidth(line) / this.#columns))
    }

    #layout(): void {
        this.#rows = process.stdout.rows
        this.#columns = process.stdout.columns
        const headingRows = this.#heading.length + 1
        // PINNED ONLY WHERE THERE IS ROOM: a panel of a row or two under a tall heading tails nothing.
        this.#top = this.#rows - headingRows > 6 ? headingRows + 1 : 1
        this.#bottom = this.#rows - 2
        let out = `${ESCAPE}r${ESCAPE}2J`
        if (this.#top > 1)
            for (let row = 0; row < this.#heading.length; row += 1)
                out += `${ESCAPE}${row + 1};1H${this.#heading[row]}`
        out += `${ESCAPE}${this.#top};${this.#bottom}r`
        // The newest lines that fit, oldest of them first.
        let first = this.#lines.length
        let used = 0
        while (first > 0) {
            used += this.#rowsOf(this.#lines[first - 1] as string)
            if (used > this.#bottom - this.#top + 1) break
            first -= 1
        }
        this.#next = this.#top
        for (let at = first; at < this.#lines.length; at += 1)
            out += this.#placed(this.#lines[at] as string)
        out += this.#completionRows()
        process.stdout.write(out + this.#divider())
        this.prompt()
    }

    /** Has the divider say `signature` in place of its hint, or its hint again where `undefined`. */
    setSignature(signature: string | undefined): void {
        if (this.#closed || signature === this.#signature) return
        this.#signature = signature
        process.stdout.write(this.#divider())
        this.prompt()
    }

    #divider(): string {
        const text = (this.#signature ?? this.#hint).slice(
            0,
            Math.max(0, this.#columns - 4),
        )
        const fill = '─'.repeat(Math.max(0, this.#columns - text.length - 4))
        const said =
            this.#signature === undefined ? this.#paint('2', text) : text
        return `${ESCAPE}${this.#rows - 1};1H${ESCAPE}2K${this.#paint('2', '── ')}${said}${this.#paint('2', ` ${fill}`)}`
    }

    /** The completions in columns, over the panel's last rows — as many rows as half the panel. */
    #completionRows(): string {
        const count = this.#completions.length
        if (count === 0) return ''
        let widest = 0
        for (const completion of this.#completions)
            widest = Math.max(widest, Bun.stringWidth(completion))
        const width = Math.min(widest + 2, this.#columns)
        const perRow = Math.max(1, Math.floor(this.#columns / width))
        const room = Math.max(1, Math.floor((this.#bottom - this.#top + 1) / 2))
        let rows = Math.ceil(count / perRow)
        // The last row says how many more there are, rather than one more of them.
        const shown = rows > room ? (room - 1) * perRow : count
        rows = Math.min(rows, room)
        let out = ''
        for (let row = 0; row < rows; row += 1) {
            let text = ''
            for (let column = 0; column < perRow; column += 1) {
                const completion = this.#completions[row * perRow + column]
                if (completion === undefined || row * perRow + column >= shown)
                    break
                text += completion.slice(0, width - 2).padEnd(width)
            }
            if (row === rows - 1 && shown < count)
                text = this.#paint(
                    '2',
                    `… ${count - shown} more — type to narrow`,
                )
            out += `${ESCAPE}${this.#bottom - rows + 1 + row};1H${ESCAPE}2K${text}`
        }
        return out
    }

    #paint(code: string, text: string): string {
        return paint(this.#color, code, text)
    }
}

/** A console call's arguments as the one line `console.log` would print. */
function formatted(args: unknown[], color: boolean): string {
    let text = ''
    for (let at = 0; at < args.length; at += 1) {
        const arg = args[at]
        if (at > 0) text += ' '
        text +=
            typeof arg === 'string' ? arg : Bun.inspect(arg, { colors: color })
    }
    return text
}
