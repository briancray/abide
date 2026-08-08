// The `abide` binary as a child process, and reading what it printed.
//
// Every claim the CLI and the lifecycle make is about a PROCESS: what it printed, which stream it
// printed on, and what the shell learned when it ended. `cli(argv)` returning a number is testable
// in-process and it is the less interesting half — an exit code that never reaches `process.exit` is
// a number nobody acts on, and `boot` installs signal handlers that would take Ctrl-C off the runner.
//
// Here rather than in whichever file needed it first: three of them spawn something now, and a helper
// copied into each is one that gets fixed in one of them. The stream reader in particular has a rule
// worth writing once — a chunk boundary is not a line boundary, and a process that is still running
// has no end to read to.
//
// The binary is reached through `abide/cli`, the public specifier, so a broken entry point fails a
// test rather than being papered over by a path.

/** The binary itself, for the one case that has to hand it a stdin the helpers below do not model. */
export const BINARY = Bun.resolveSync('abide/cli', import.meta.dir)

/** The example package, which is the working directory a command means unless a case says otherwise. */
export const EXAMPLE_ROOT = `${import.meta.dir}/..`

/** Everything a finished process said. `code` is `-1` for one that was killed rather than exited. */
export interface Ended {
    code: number
    out: string
    err: string
}

export interface SpawnOptions {
    cwd?: string | undefined
    /**
     * The parent's environment with these over it, so a knob a case does not name is the one the
     * developer's shell has — which is what the command would see in their hands. `undefined` REMOVES
     * a name rather than setting it empty, because "nobody declared PORT" is a claim a case makes and
     * a developer's own shell must not be able to answer it.
     */
    env?: Record<string, string | undefined> | undefined
}

/** A child with both streams piped — what a case that reads a LIVE process starts from. */
export function spawn(command: string[], options?: SpawnOptions): Bun.Subprocess<'ignore', 'pipe', 'pipe'> {
    return Bun.spawn(command, {
        stdout: 'pipe',
        stderr: 'pipe',
        ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
        env: options?.env === undefined ? Bun.env : environment(options.env),
    })
}

/**
 * Wait for a child and take everything it said.
 *
 * Both streams are drained CONCURRENTLY and before the exit is awaited: a process that fills one pipe
 * while this reads the other blocks forever, and a helper that got the order wrong would hang rather
 * than fail.
 */
export async function ended(child: {
    stdout: ReadableStream<Uint8Array>
    stderr: ReadableStream<Uint8Array>
    exited: Promise<number>
    exitCode: number | null
}): Promise<Ended> {
    const [out, err] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ])
    await child.exited
    return { code: child.exitCode ?? -1, out, err }
}

/** Run the binary to completion. */
export function abide(argv: string[], options?: SpawnOptions): Promise<Ended> {
    return ended(spawn(['bun', BINARY, ...argv], options))
}

function environment(declared: Record<string, string | undefined>): Record<string, string> {
    const merged: Record<string, string> = { ...(Bun.env as Record<string, string>) }
    for (const name in declared) {
        const value = declared[name]
        if (value === undefined) delete merged[name]
        else merged[name] = value
    }
    return merged
}

/**
 * The lines of a stream that is still being written to, one at a time.
 *
 * `Response(stream).text()` cannot be used for any of this: a process under test is long-running by
 * design, and reading to the end would be waiting for something that has no end. A chunk boundary is
 * not a line boundary either, so the tail of one is held for the head of the next — and the CURSOR is
 * what keeps that from re-slicing the held text once per line, which is the same shape `wire.ts`'s
 * line reader settled on for the same reason.
 */
export async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const decoder = new TextDecoder()
    let held = ''
    let from = 0
    for await (const chunk of stream) {
        // Compacted once per CHUNK rather than once per line: what is left is the partial tail, which
        // is bounded by a chunk, where slicing per line is O(n²) over a feed that never ends.
        held = held.slice(from) + decoder.decode(chunk, { stream: true })
        from = 0
        for (;;) {
            const at = held.indexOf('\n', from)
            if (at < 0) break
            // Empty lines are dropped: a trailing newline ends the line before it rather than
            // starting an empty one, and no case here asserts a blank.
            if (at > from) yield held.slice(from, at)
            from = at + 1
        }
    }
    if (held.length > from) yield held.slice(from)
}

/** The first `count` lines, without waiting for the rest of a stream that never ends. */
export async function linesUntil(stream: ReadableStream<Uint8Array>, count: number): Promise<string[]> {
    const lines: string[] = []
    const reader = readLines(stream)
    for await (const line of reader) {
        lines.push(line)
        if (lines.length >= count) break
    }
    await reader.return(undefined)
    return lines
}

/** The first line a process prints. */
export async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
    return (await linesUntil(stream, 1))[0] as string
}

/** A live child and the one question every case asks it: what did it say next. */
export interface Reading {
    child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
    /** Lines until one carries `text` — `''` for simply the next one. */
    until: (text: string) => Promise<string>
}

/**
 * Start something and read its stdout a line at a time.
 *
 * The triple every case that watches a LIVE process needs — the child, the line reader over its
 * stdout, and a waiter that carries stderr so a process which died says why instead of hanging until
 * the runner's timeout. Written once here for the same reason `readLines` is.
 */
export function reading(command: string[], options?: SpawnOptions): Reading {
    const child = spawn(command, options)
    const lines = readLines(child.stdout)
    return { child, until: (text) => lineWith(lines, text, child.stderr) }
}

/**
 * Lines off a live process until one carries `text` — `''` for simply the next one, since every
 * string contains the empty one.
 *
 * A process says more than one thing and only one of them is the claim, so a case waits for a line
 * that ARRIVES rather than counting to a line number. A stream that ENDS first is the interesting
 * failure: `errors` is drained into the message so the case names why the process died instead of
 * hanging until the runner's timeout.
 */
export async function lineWith(
    lines: AsyncGenerator<string>,
    text: string,
    errors?: ReadableStream<Uint8Array>,
): Promise<string> {
    for (;;) {
        const step = await lines.next()
        if (step.done === true) {
            const said = errors === undefined ? '' : `: ${await new Response(errors).text()}`
            throw new Error(`the process ended before it said "${text}"${said}`)
        }
        if (step.value.includes(text)) return step.value
    }
}
