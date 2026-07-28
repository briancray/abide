// log — isomorphic structured logging (CO2.1/CO2.2). Callable `log(...)` plus level methods
// `.info` / `.warn` / `.error` / `.trace`, and `.channel(name)` for a namespaced logger.
//
// Server: structured lines to stdout (info/trace/log) and stderr (warn/error) in one of three shapes
// (`logFormat`) — a COLOURED COLUMN line when stdout is a TTY (a human is reading), else the compact
// tab-separated line (level, time, [channel], traceparent, message); `ABIDE_LOG_FORMAT` names the two
// machine formats, `tsv` and `json`. Client: `console`, with the channel badge tinted the same
// colour the terminal uses. The active request's `traceparent` (CO2.3) is auto-correlated into each
// server line.
//
// CHANNELS + GATING. Every line carries a channel label. The root `log(...)` uses the DEFAULT
// channel — the app name (`ABIDE_APP_NAME`, else the `__ABIDE_APP_NAME__` global, else "abide") —
// and is always on: it is the app's own stream. `.channel(name)` produces a NAMED channel gated by
// the `debug`-npm pattern (server: `DEBUG=cache,rpc` / `DEBUG=*`; browser: `localStorage.debug`),
// so framework internals — all under the `abide:*` namespace — stay quiet until `DEBUG=abide:*`
// asks for them. ONE exception: `error` always emits regardless of gating, so operational failures
// surface even on a silent channel.
//
// `trace` is referenced only inside the emit path (never at module load) so this module never
// participates in an import cycle with the request scope.

import { debugPatternMatches } from './internal/debugPatternMatches.ts'
import { formatLogLine } from './internal/formatLogLine.ts'
import { isBrowser } from './internal/isBrowser.ts'
import { logChannelColor } from './internal/logChannelColor.ts'
import { logFeed } from './internal/logFeed.ts'
import { logFormat } from './internal/logFormat.ts'
import { readEnv } from './internal/readEnv.ts'
import { trace } from './trace.ts'

type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'trace'

export interface ChannelLogger {
    (...args: unknown[]): void
    info(...args: unknown[]): void
    warn(...args: unknown[]): void
    error(...args: unknown[]): void
    trace(...args: unknown[]): void
}

export interface Logger extends ChannelLogger {
    channel(name: string): ChannelLogger
}

// The DEFAULT channel label — the app's own stream. Server boot sets `ABIDE_APP_NAME` from the
// project's package.json (loadApp); the client bootstrap may seed the `__ABIDE_APP_NAME__` global.
// Falls back to "abide" for bare scripts and un-named contexts.
function defaultChannel(): string {
    const fromEnv = readEnv('ABIDE_APP_NAME')
    if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
    const fromGlobal = (globalThis as { __ABIDE_APP_NAME__?: string }).__ABIDE_APP_NAME__
    if (typeof fromGlobal === 'string' && fromGlobal.length > 0) return fromGlobal
    return 'abide'
}

// The active debug spec: `DEBUG` on the server, `localStorage.debug` in the browser (the debug-npm
// browser convention) so `abide:*` channels are enable-able on both sides of the isomorphism.
function debugSpec(): string | undefined {
    const fromEnv = readEnv('DEBUG')
    if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
    const store = (globalThis as { localStorage?: { getItem(key: string): string | null } })
        .localStorage
    if (store !== undefined) {
        const fromStore = store.getItem('debug') ?? store.getItem('DEBUG')
        if (fromStore !== null && fromStore.length > 0) return fromStore
    }
    return undefined
}

// The debug-npm gate: a channel emits when DEBUG names it (exact), when DEBUG is `*`, or when a
// listed pattern ends in `*` and prefixes the channel name (e.g. `abide:*` lights `abide:memo`).
// The grammar itself lives in `debugPatternMatches` because a remote `logs` subscriber filters with
// the same spelling.
function channelEnabled(channel: string): boolean {
    const debug = debugSpec()
    if (debug === undefined) return false
    return debugPatternMatches(debug, channel)
}

function formatArg(arg: unknown): string {
    if (typeof arg === 'string') return arg
    if (arg instanceof Error) return arg.stack ?? arg.message
    try {
        return JSON.stringify(arg)
    } catch {
        return String(arg)
    }
}

function emit(level: LogLevel, channel: string | undefined, args: unknown[]): void {
    // A named channel is gated by the debug spec; `error` bypasses gating so failures always
    // surface. The default channel (undefined) is the app's own stream and always emits.
    const toStdout = channel === undefined || level === 'error' || channelEnabled(channel)

    // THE GATE IS NOT THE FAN-OUT. A gated line is still offered to the log feed, so `logs --debug
    // abide:rpc` can light a framework channel on a LIVE deployment that was booted without it — the
    // thing that makes a remote feed worth having at all. The cost is that a gated line now builds its
    // message string when the feed is on; with the feed off (the default) this is one property load
    // and the early return below is exactly today's behaviour.
    if (!toStdout && !logFeed.enabled) return

    const label = channel ?? defaultChannel()

    if (isBrowser) {
        if (!toStdout) return
        const console = (
            globalThis as unknown as {
                console?: Record<string, ((...a: unknown[]) => void) | undefined>
            }
        ).console
        if (console === undefined) return
        const method = console[level] ?? console.log
        if (method === undefined) return
        // `%c` tints the badge with the channel's own colour — the same hash the terminal uses, so a
        // channel looks the same on both sides. The trailing empty style scopes it to the badge and
        // leaves the args as real values (objects stay inspectable, not stringified).
        method(`%c[${label}]%c`, `color:${logChannelColor(label).css}`, '', ...args)
        return
    }

    const now = new Date()
    const traceparent = trace()
    const message = args.map(formatArg).join(' ')

    // The STRUCTURED record goes to the feed, never a formatted line: the subscriber's own terminal
    // decides the shape, so a remote tail renders through the same `prettyLogLine` this process would
    // have used and looks identical to reading the server's stdout.
    logFeed.publish(level, label, message, traceparent, now)

    if (!toStdout) return

    const line = formatLogLine(level, label, message, traceparent, now, logFormat())

    const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout
    stream.write(`${line}\n`)
}

function makeChannelLogger(channel: string | undefined): ChannelLogger {
    const logger = ((...args: unknown[]): void => emit('log', channel, args)) as ChannelLogger
    logger.info = (...args: unknown[]): void => emit('info', channel, args)
    logger.warn = (...args: unknown[]): void => emit('warn', channel, args)
    logger.error = (...args: unknown[]): void => emit('error', channel, args)
    logger.trace = (...args: unknown[]): void => emit('trace', channel, args)
    return logger
}

// Channel loggers are memoized: the channel set is fixed and small (the `abide:*` framework channels
// plus whatever an app names), while `log.channel('abide:rpc')` sits on per-request and per-render
// paths — building five fresh closures per call is pure garbage.
const CHANNEL_LOGGERS = new Map<string, ChannelLogger>()

export const log: Logger = Object.assign(makeChannelLogger(undefined), {
    channel(name: string): ChannelLogger {
        let logger = CHANNEL_LOGGERS.get(name)
        if (logger === undefined) {
            logger = makeChannelLogger(name)
            CHANNEL_LOGGERS.set(name, logger)
        }
        return logger
    },
})
