// What a log line looks like on a TERMINAL — the three forms a browser can never be in.
//
// Split out of `log.ts`, and the split is a bundling decision rather than a tidying one. `logShape()`
// answers `plain` for a browser and nothing else can move it there: `ABIDE_LOG_FORMAT` is read
// through `config()`, and a client has no environment to declare one in. So `json`, `tsv` and the
// ANSI arm are unreachable in a browser — and they shipped there anyway, because `emit` called
// `formatLogLine` unconditionally and a bundler cannot prove which arm a browser takes. That is 1,872
// minified bytes of color tables, tab escaping and ISO stamping on every page, plus `env.ts`'s
// `stdoutIsTTY` behind it.
//
// So this is installed rather than imported: `abide/server` calls `useLineWriter(terminalLine)` at
// import, next to the `useAppNameSource` it already installs there, and a browser keeps `log.ts`'s
// own `plainLine`. The same inversion `useLogSink`, `useAppNameSource`, `useConfigSource`,
// `useHealthSource` and `useIdentitySource` already are — this one just happens to be paid for in
// bytes rather than in a `node:` import.
//
// It stays in `$shared` because both readers are on this side of the line: the installer above, and
// `abide logs`, which renders records somebody ELSE's process wrote and renders them by these rules.
// Nothing in a client graph imports this file, which is the whole of what keeps it off a page.

import { type Level, type LineWriter, plainLine, READABLE_TRACE } from '../log.ts'
import { colorAllowed, stdoutIsTTY } from './env.ts'
import { textKnob } from './knobs.ts'

/**
 * The four forms one line takes. `abide logs` renders a record the feed handed it, and it renders it
 * by the rules the console was already following — so the decision is `logShape()`'s, not a caller's.
 */
export type LogShape = 'color' | 'plain' | 'tsv' | 'json'

// A browser is decided by having a document and no terminal behind it: ANSI would arrive as literal
// junk in the console, and a tab is not a field separator anybody there can use. Still asked, though
// this file is only installed on a server: the lane where a document AND a process both exist is real
// — the DOM emulator every `bun test` run preloads — and a suite importing `abide/server` lands in it.
//
// Latched on the first line written rather than at import, for the reason `stdoutIsTTY` states: bun
// BUILDS `process.stdout` on the first touch and it costs ~6ms, so a module-level const charges it to
// every importer.
let inBrowser: boolean | null = null

/**
 * One decision, not two. Whether a line is machine-readable and whether it carries color are the
 * same question asked of the same variables, and answering them separately meant keeping the
 * `NO_COLOR` / `FORCE_COLOR` / `isTTY` ordering consistent in two places by hand — so that ordering
 * is `colorAllowed`'s, which the CLI's usage screen asks too.
 *
 * Exported for the tail: a CLI printing somebody else's records answers the same question about its
 * OWN stdout.
 */
export function logShape(): LogShape {
    // Declared beats inferred everywhere, which is also what makes the machine formats testable from a
    // demo that runs in both lanes.
    const declared = textKnob('ABIDE_LOG_FORMAT')
    if (declared === 'json') return 'json'
    if (declared === 'tsv') return 'tsv'
    if (inBrowser === null) inBrowser = typeof document !== 'undefined' && !stdoutIsTTY()
    if (inBrowser) return 'plain'
    return colorAllowed() ? 'color' : 'tsv'
}

// Six that stay legible on both a light and a dark terminal, picked by hashing the channel so one
// channel keeps its color for the life of the process without anything remembering the assignment.
const CHANNEL_COLORS = [36, 35, 34, 33, 32, 31]

function channelColor(channel: string): number {
    let hash = 0
    for (let i = 0; i < channel.length; i++) hash = (hash * 31 + channel.charCodeAt(i)) | 0
    return CHANNEL_COLORS[Math.abs(hash) % CHANNEL_COLORS.length] as number
}

const LEVEL_COLORS: Record<Level, number> = {
    log: 90,
    info: 90,
    warning: 33,
    error: 31,
    debug: 90,
}

/** Probes before it replaces: a message with nothing to escape costs one test. */
function oneLine(message: string): string {
    if (!/[\t\n\r\\]/.test(message)) return message
    return message.replace(/[\t\n\r\\]/g, (ch) =>
        ch === '\t' ? '\\t' : ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : '\\\\',
    )
}

/**
 * The five fields as the line one shape writes.
 *
 * POSITIONAL rather than taking a `LogRecord`, because the writer below does not have one and must
 * not have to build one: a record costs an object and — worse — the ISO string, which is the most
 * expensive thing on this path and is skipped outright for a terminal. A reader that HAS a record
 * spreads its fields in, which is the cheap direction and is why `abide logs` calls this rather than
 * `terminalLine`.
 */
export function formatLogLine(
    level: Level,
    channel: string,
    message: string,
    stamped: string,
    traced: string | null,
    since: number,
    form: LogShape,
): string {
    if (form === 'json') return JSON.stringify({ time: stamped, level, channel, message, trace: traced })
    // Five columns always, empty where there is no id: a row whose column count depends on whether a
    // request was in flight is one no `cut -f` can read.
    if (form === 'tsv') return `${stamped}\t${level}\t${channel}\t${oneLine(message)}\t${traced ?? ''}`
    // `0` for the stamp `plainLine` is typed to take and never reads: a readable line carries no
    // timestamp, which is the whole reason `stamped` above was built for the other two forms only.
    if (form !== 'color') return plainLine(level, channel, message, 0, traced, since)

    const delta = `+${since}ms`
    const suffix = level === 'log' ? '' : ` ${level}`
    // Short, and trailing with the delta rather than leading: both are metadata about the line, and
    // the message is what someone reading a terminal is scanning for.
    const short = traced === null ? '' : ` ${traced.slice(0, READABLE_TRACE)}`
    return (
        `\x1b[${channelColor(channel)}m${channel}\x1b[0m` +
        (suffix === '' ? '' : `\x1b[${LEVEL_COLORS[level]}m${suffix}\x1b[0m`) +
        ` ${message}\x1b[90m${short} ${delta}\x1b[0m`
    )
}

/**
 * What a line written ON A SERVER looks like — `abide/server` installs this over `plainLine`.
 *
 * Builds its own ISO stamp, for the two forms that carry one. The feed builds its own as well, so a
 * process with `ABIDE_LOGS` open AND `ABIDE_LOG_FORMAT=json` set formats the timestamp twice per
 * line where it used to format it once. That is the price of `emit` no longer knowing what shape it
 * is writing, and it is one `toISOString` on a line already being both rendered and published — paid
 * only where both are on, against 1,872 bytes on every page load where neither can be.
 */
export const terminalLine: LineWriter = (level, channel, message, now, traced, since) => {
    const form = logShape()
    const stamped = form === 'json' || form === 'tsv' ? new Date(now).toISOString() : ''
    return formatLogLine(level, channel, message, stamped, traced, since, form)
}
