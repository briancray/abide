// `abide logs` — the client for `GET /__abide/logs`.
//
// The endpoint was built first and on purpose: it is `channel({ tail })` and `ch.tail()` and nothing
// else, so the ring, the cap, the replay and the live subscribe are the primitive's. That leaves this
// side with exactly two jobs — read a never-ending jsonl body, and print each record the way the
// console that wrote it would have.
//
// The SECOND one is why this file imports `$shared/log.ts` rather than formatting anything: a tail
// that spelled a line differently from the app's own stdout would be a second answer to the same
// question, and an operator comparing the two would be right to call one of them broken. The shape is
// decided by THIS process's stdout — pretty at a terminal, tsv through a pipe — because that is what
// the rules were always asking about, and it is the reason a record crosses the wire rather than a
// rendered line.

import { env, envNumber } from '$shared/internal/env.ts'
import { LOGS_PATH } from '$shared/internal/PATHS.ts'
import { JSONL_TYPE, payloadOf } from '$shared/internal/wire.ts'
import { formatLogLine, type LogRecord, logShape, writeLogLine } from '$shared/log.ts'
import { CLI_EXIT_CODES, exitForStatus } from '../CLI_EXIT_CODES.ts'

/** What `PORT` means when nobody set it — the same default the server half serves on. */
const DEFAULT_PORT = 3000

/**
 * Which app this is about.
 *
 * `ABIDE_APP_URL` is the remote CLI's own variable and names an app somewhere else; `APP_URL` is the
 * app's own public URL and is what a process that is serving already has set. Falling back to a local
 * port last is what makes `abide logs` work in the window where somebody just ran the thing in
 * another terminal, which is the case this command exists for.
 */
export function appTarget(): string {
    return (
        env('ABIDE_APP_URL') ??
        env('APP_URL') ??
        `http://localhost:${Math.floor(envNumber('PORT', DEFAULT_PORT))}`
    )
}

export async function logs(argv: string[]): Promise<number> {
    if (argv.length > 0) {
        console.error(`abide logs: takes no arguments, got ${argv[0]}`)
        return CLI_EXIT_CODES.usage
    }

    const base = appTarget()
    const address = new URL(LOGS_PATH, base).href
    const token = env('ABIDE_APP_TOKEN')
    // A bearer if there is one. The feed itself is gated by `ABIDE_LOGS` rather than by a token — the
    // header is here for what an operator put IN FRONT of the app, which is the only thing between a
    // remote CLI and a port that is usually not open.
    const headers: Record<string, string> = { accept: JSONL_TYPE }
    if (token !== undefined) headers.authorization = `Bearer ${token}`

    let answered: Response
    try {
        answered = await fetch(address, { headers })
    } catch (failure) {
        // Nothing answered, which has no status and so no HTTP code to map. That is what `1` is.
        console.error(`abide logs: ${base} did not answer — ${(failure as Error).message}`)
        return CLI_EXIT_CODES.failed
    }

    if (!answered.ok) {
        // Reported rather than swallowed: a 404 here means the feed is closed, and `set ABIDE_LOGS`
        // is the one thing the operator needs to read.
        const said = refusal(await payloadOf(answered).catch(() => null))
        console.error(`abide logs: ${address} answered ${answered.status}${said === '' ? '' : ` — ${said}`}`)
        return exitForStatus(answered.status)
    }

    const form = logShape()
    // The `+Nms` a readable line ends with is "since the last line on THAT channel", and it stays
    // that here: the delta is computed off the record's own time rather than off when this process
    // read it, so a replayed ring shows the spacing the app actually wrote it with instead of the
    // speed the socket handed it over at.
    //
    // Kept only for the shapes that PRINT it. `tsv` is what a pipe gets and `json` what a collector
    // does, and neither carries a delta — so a tail being piped somewhere, which is the loud case,
    // does not pay a parse and a map write per record for a field nothing reads.
    const readable = form === 'colour' || form === 'plain'
    const lastAt = new Map<string, number>()

    await readLines(answered, (line) => {
        let record: LogRecord
        try {
            record = JSON.parse(line) as LogRecord
        } catch {
            // Not ours. Something between here and the app is writing into the body, and printing it
            // is more use than dropping it.
            console.log(line)
            return
        }
        let since = 0
        if (readable) {
            const at = Date.parse(record.time)
            const previous = lastAt.get(record.channel)
            lastAt.set(record.channel, at)
            since = previous === undefined || !Number.isFinite(at) ? 0 : at - previous
        }
        writeLogLine(
            record.level,
            formatLogLine(
                record.level,
                record.channel,
                record.message,
                record.time,
                record.trace,
                since,
                form,
            ),
        )
    })

    // The body ended: the app stopped, or something in the middle closed the connection. A tail whose
    // subject went away has done its job — `tail -f` on a file that is removed does not fail either.
    return CLI_EXIT_CODES.ok
}

/**
 * What a refusal actually said, out of whatever `payloadOf` made of the body.
 *
 * Every failure abide builds crosses as `{ error: { name, message } }`, so the message is read out of
 * one rather than printed as the JSON it arrived in — a person reading `abide logs:` on a terminal
 * should not have to decode a frame to find the sentence. Anything else — a proxy's HTML page, a
 * plain-text refusal — is its first line, which is as much of an unknown body as belongs on one.
 */
function refusal(payload: unknown): string {
    const carried = (payload as { error?: { message?: unknown } } | null)?.error?.message
    if (typeof carried === 'string') return carried
    if (typeof payload !== 'string') return ''
    return payload.trim().split('\n')[0] as string
}

/**
 * A never-ending jsonl body, one line at a time.
 *
 * Its own reader rather than `wire.ts`'s: that one owns the rpc lane's frame semantics — an error
 * frame is a throw there — and delegating to it from here would put a generator hand-off, and so a
 * microtask, on every chunk of every rpc stream to save these fifteen lines. What IS shared is the
 * reason for the cursor: dropping the head of a k-line read copies what is left of it k times, and a
 * stream's whole point is that the buffer is not small.
 */
async function readLines(response: Response, onLine: (line: string) => void): Promise<void> {
    const body = response.body
    if (body === null) return
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let held = ''
    let from = 0
    for (;;) {
        const step = await reader.read()
        if (step.done === true) break
        if (from > 0) {
            held = held.slice(from)
            from = 0
        }
        held += decoder.decode(step.value, { stream: true })
        for (;;) {
            const at = held.indexOf('\n', from)
            if (at < 0) break
            const line = held.slice(from, at)
            from = at + 1
            if (line !== '') onLine(line)
        }
    }
    const rest = held.slice(from) + decoder.decode()
    if (rest.trim() !== '') onLine(rest)
}
