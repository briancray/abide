// What reached a console, so a case can assert a line the way it asserts a value.
//
// A logger's whole observable behaviour is what reaches a console, so swapping the five methods is
// the only honest way to read one — and swapping them is exactly what a collector does, which is why
// a demo can do it without reaching inside the framework.
//
// Here rather than in the suite that needed it first, for the reason `env.ts` gives about `withEnv`:
// four suites now make a claim about a line — `logging` about every format and gate, and `ceilings`,
// `lifecycle` and `health` each about one warning that says a degradation happened rather than
// letting it be silent. A helper copied into four is one that gets fixed in one of them.

export interface Written {
    /** The console method the level asked for. */
    level: string
    /**
     * The composed LINE — the first argument, and nothing after it.
     *
     * Not every argument joined: a line carrying extras is `<the line>` plus live objects, and every
     * reader here wants the line. `channelOf` parses this under `ABIDE_LOG_FORMAT=json`, so folding a
     * stringified `Error` onto the end of the record makes `JSON.parse` throw on text that is no longer
     * JSON. What the extras were is `args`, below, which is the honest place to ask.
     */
    text: string
    /**
     * What the call was actually handed, untouched.
     *
     * `text` is the readable form and it cannot answer the one question a line carrying an `Error`
     * raises: `String(err)` is `name: message` with no stack in it, so a line built by interpolating
     * the error and a line passing the OBJECT beside it stringify to nearly the same thing while only
     * the second gives a console a stack to expand. Identity is the only honest check for that.
     */
    args: readonly unknown[]
}

const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

/** Every line the region wrote, and which console method wrote it. */
export function capture(fn: () => void): Written[]
export function capture(fn: () => Promise<unknown>): Promise<Written[]>
export function capture(fn: () => unknown): Written[] | Promise<Written[]> {
    const written: Written[] = []
    const held = METHODS.map((name) => console[name])
    const restore = (): void => {
        for (let i = 0; i < METHODS.length; i++)
            console[METHODS[i] as (typeof METHODS)[number]] = held[i] as never
    }
    for (const name of METHODS) {
        console[name] = (...args: unknown[]): void => {
            written.push({ level: name, text: args.length === 0 ? '' : String(args[0]), args })
        }
    }
    // A request is answered over at least one await, so the swap has to outlive the call rather than
    // be put back by a `finally` that runs first. Widened here rather than copied into a second
    // helper: what a case asserts is the same lines either way, and two of these would be two places
    // to remember the restore in.
    let ran: unknown
    try {
        ran = fn()
    } catch (failure) {
        restore()
        throw failure
    }
    if (typeof (ran as Promise<unknown> | undefined)?.then !== 'function') {
        restore()
        return written
    }
    return (ran as Promise<unknown>).then(
        () => {
            restore()
            return written
        },
        (failure: unknown) => {
            restore()
            throw failure
        },
    )
}

/** The lines a region wrote on one console method — the shape a "said once, as a warning" claim needs. */
export function writtenAt(written: Written[], level: string): Written[] {
    const found: Written[] = []
    for (const line of written) if (line.level === level) found.push(line)
    return found
}
