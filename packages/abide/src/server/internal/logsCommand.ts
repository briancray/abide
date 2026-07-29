// `logs` — a live feed of a deployment's log records (`GET /__abide/logs`, SSE).
//
// The records arrive STRUCTURED and are rendered here, by `formatLogLine` — the same function the
// server uses for its own stdout. So `app --url https://… logs` at a terminal is byte-identical to
// reading that server's console, and through a pipe degrades to the same `tsv` a collector would have
// ingested. That is also why this command ignores the global `--pretty`/`--compact` (which shape a JSON
// VALUE): the shape of a log line is already governed by `ABIDE_LOG_FORMAT` / `NO_COLOR` / the TTY, and
// a second spelling for one decision is how the two surfaces drift apart.
//
// It PREFLIGHTS `/__abide/health`. Nothing else in the CLI does — `--url` is deliberately lazy, so a
// bad origin normally surfaces at the first call as a plain "unreachable". A log tail is the one
// command where that is not good enough: it is expected to sit there producing nothing, so a wrong
// host, a 404 from a deployment too old to have the route, and a healthy but quiet app are three
// states a reader cannot tell apart from an empty screen. One round trip buys a real answer.

import { formatLogLine } from '../../shared/internal/formatLogLine.ts'
import { LOGS_ROUTE } from '../../shared/internal/LOGS_ROUTE.ts'
import type { LogRecord } from '../../shared/internal/logFeed.ts'
import { logFormat } from '../../shared/internal/logFormat.ts'
import { readLines } from '../../shared/internal/readLines.ts'
import { CLI_EXIT_CODES } from './CLI_EXIT_CODES.ts'
import { cliExitCodeForStatus } from './cliExitCodeForStatus.ts'

export interface LogsCommandOptions {
    origin: string
    token?: string | undefined
    // argv after the `logs` word.
    argv: string[]
    write(text: string): void
    writeError(text: string): void
    // Aborts the feed without ending the process — the REPL's Ctrl-C, so a detached tail returns to
    // the prompt instead of killing the session.
    signal?: AbortSignal | undefined
}

interface LogsFlags {
    tail: string | undefined
    level: string | undefined
    debug: string | undefined
    trace: string | undefined
    follow: boolean
}

const LEVELS = ['trace', 'log', 'info', 'warn', 'error']

function parseFlags(argv: string[]): LogsFlags | string {
    const flags: LogsFlags = {
        tail: undefined,
        level: undefined,
        debug: undefined,
        trace: undefined,
        follow: true,
    }
    for (let index = 0; index < argv.length; index++) {
        const token = argv[index]
        if (token === undefined) break
        if (token === '--no-follow' || token === '-n') {
            flags.follow = false
            continue
        }
        if (token === '--follow' || token === '-f') {
            flags.follow = true
            continue
        }
        const equals = token.indexOf('=')
        const name = equals === -1 ? token : token.slice(0, equals)
        const inlineValue = equals === -1 ? undefined : token.slice(equals + 1)
        const value = inlineValue ?? argv[++index]
        if (value === undefined) return `logs: ${name} needs a value.`
        if (name === '--tail') flags.tail = value
        else if (name === '--level') flags.level = value
        else if (name === '--debug' || name === '--channel') flags.debug = value
        else if (name === '--trace') flags.trace = value
        else return `logs: unknown flag ${name}.`
    }
    if (flags.level !== undefined && !LEVELS.includes(flags.level)) {
        return `logs: --level must be one of ${LEVELS.join(', ')}.`
    }
    if (flags.tail !== undefined && !Number.isFinite(Number.parseInt(flags.tail, 10))) {
        return 'logs: --tail needs a number.'
    }
    return flags
}

function feedUrl(origin: string, flags: LogsFlags): string {
    const url = new URL(`${origin}${LOGS_ROUTE}`)
    if (flags.tail !== undefined) url.searchParams.set('tail', flags.tail)
    if (flags.level !== undefined) url.searchParams.set('level', flags.level)
    if (flags.debug !== undefined) url.searchParams.set('debug', flags.debug)
    if (flags.trace !== undefined) url.searchParams.set('trace', flags.trace.toLowerCase())
    if (!flags.follow) url.searchParams.set('follow', '0')
    return url.toString()
}

function unreachable(origin: string, caught: unknown, options: LogsCommandOptions): number {
    options.writeError(
        `${JSON.stringify({
            error: 'unreachable',
            target: origin,
            message: caught instanceof Error ? caught.message : String(caught),
        })}\n`,
    )
    return CLI_EXIT_CODES.failed
}

// Confirm there is an abide server at the other end BEFORE opening a stream that is supposed to be
// silent. A non-abide host answers this with something that is not the health doc, which is a far more
// useful thing to print than a tail that never emits.
async function preflight(options: LogsCommandOptions): Promise<number | undefined> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`
    let response: Response
    try {
        response = await fetch(`${options.origin}/__abide/health`, {
            headers,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        })
    } catch (caught) {
        return unreachable(options.origin, caught, options)
    }
    // A 503 is an app reporting itself unhealthy — exactly when you want its logs, so it is not fatal
    // here. Only an answer that is not an abide health doc at all stops us.
    let doc: unknown
    try {
        doc = await response.json()
    } catch {
        doc = undefined
    }
    if (typeof doc !== 'object' || doc === null || !('reachable' in doc)) {
        options.writeError(
            `${JSON.stringify({
                error: 'not-an-abide-server',
                target: options.origin,
                status: response.status,
                message: `${options.origin}/__abide/health did not answer with an abide health document`,
            })}\n`,
        )
        return CLI_EXIT_CODES.failed
    }
    return undefined
}

function renderRecord(record: LogRecord, options: LogsCommandOptions): void {
    const line = formatLogLine(
        record.level,
        record.channel,
        record.message,
        record.traceparent,
        new Date(record.time),
        logFormat(),
    )
    // The same split the server makes locally, so `logs 2>/dev/null` behaves like running the app and
    // dropping its stderr.
    if (record.level === 'warn' || record.level === 'error') options.writeError(`${line}\n`)
    else options.write(`${line}\n`)
}

export async function logsCommand(options: LogsCommandOptions): Promise<number> {
    const flags = parseFlags(options.argv)
    if (typeof flags === 'string') {
        options.writeError(`${flags}\n`)
        return CLI_EXIT_CODES.usage
    }

    const failed = await preflight(options)
    if (failed !== undefined) return failed

    const headers: Record<string, string> = { accept: 'text/event-stream' }
    if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`

    let response: Response
    try {
        response = await fetch(feedUrl(options.origin, flags), {
            headers,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        })
    } catch (caught) {
        return unreachable(options.origin, caught, options)
    }

    if (!response.ok) {
        const body = await response.text()
        options.writeError(body.endsWith('\n') ? body : `${body}\n`)
        return cliExitCodeForStatus(response.status)
    }

    const body = response.body
    if (body === null) return CLI_EXIT_CODES.ok

    // SSE framing: `data: <json>` lines, `:`-prefixed comments (the prelude and the idle heartbeat)
    // ignored. One record per frame, so a line reader is the whole parser.
    const consume = (line: string): void => {
        if (!line.startsWith('data:')) return
        const payload = line.slice(5).trim()
        if (payload === '') return
        try {
            renderRecord(JSON.parse(payload) as LogRecord, options)
        } catch {
            // A frame we cannot parse is still evidence — print it rather than silently dropping a
            // line from something whose entire job is not dropping lines.
            options.write(`${payload}\n`)
        }
    }

    try {
        for await (const line of readLines(body as unknown as AsyncIterable<Uint8Array>)) {
            consume(line.trimEnd())
        }
    } catch (caught) {
        // A detach (REPL Ctrl-C) aborts the fetch, which lands here. That is a clean end to a tail, not
        // a failure — the reader asked to stop.
        if (options.signal?.aborted === true) return CLI_EXIT_CODES.ok
        options.writeError(
            `${JSON.stringify({
                error: 'stream-interrupted',
                message: caught instanceof Error ? caught.message : String(caught),
            })}\n`,
        )
        return CLI_EXIT_CODES.failed
    }
    return CLI_EXIT_CODES.ok
}
