import { logTapSlot } from './logTapSlot.ts'
import { requestScopeSlot } from './requestScopeSlot.ts'
import type { LogRecord } from './types/LogRecord.ts'
import type { LogVoice } from './types/LogVoice.ts'

const hasBun = typeof Bun !== 'undefined'
const useColor = hasBun && Bun.enableANSIColors
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'

// Wraps `text` in a Bun-resolved ANSI color escape; no-op when colors are disabled or unavailable (browser).
function paint(color: string, text: string): string {
    if (!useColor) {
        return text
    }
    return `${Bun.color(color, 'ansi-256')}${text}${RESET}`
}

// Applies the ANSI dim attribute; no-op when colors are disabled.
function dim(text: string): string {
    if (!useColor) {
        return text
    }
    return `${DIM}${text}${RESET}`
}

// Maps an HTTP status code to a color that matches the usual server-log convention.
function colorStatus(status: number): string {
    if (status >= 500) {
        return paint('red', String(status))
    }
    if (status >= 400) {
        return paint('yellow', String(status))
    }
    if (status >= 300) {
        return paint('cyan', String(status))
    }
    return paint('green', String(status))
}

// Maps an HTTP method to a color so the request log line is easy to scan.
function colorMethod(method: string): string {
    const upper = method.toUpperCase()
    if (upper === 'GET') {
        return paint('green', upper)
    }
    if (upper === 'POST') {
        return paint('blue', upper)
    }
    if (upper === 'PUT' || upper === 'PATCH') {
        return paint('yellow', upper)
    }
    if (upper === 'DELETE') {
        return paint('red', upper)
    }
    return paint('white', upper)
}

/* json emission is a server concern (stdout ingestion); the browser console always gets tsv. Read per call — log volume never makes this hot. */
function useJson(): boolean {
    return typeof process !== 'undefined' && process.env.ABIDE_LOG_FORMAT === 'json'
}

/* `+12.30ms` — unpadded: the timing trails the line, so no width keeps columns aligned. */
function formatElapsed(ms: number): string {
    return `+${ms.toFixed(2)}ms`
}

/* `14:23:01.072` — local wall-clock to the ms. Every record carries `ts`, so the
   tsv line always leads with one; `+elapsedMs` still trails as the request-relative
   timing — the two are different axes (when it happened vs how long it took). */
function formatClock(ts: number): string {
    const date = new Date(ts)
    const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

/*
Builds the record from the emission's own fields plus the ambient request
scope (trace, elapsed, method+path), then renders it through the active
formatter. The scope is read at emission time so a record emitted from a
stream-flush callback re-entered into the scope still carries its context.
Internal seam shared by the public logger and the framework's closing-record
emitter; console.* is the side effect — logging is intentionally impure.
*/
export function emitLogRecord(fields: Omit<LogRecord, 'ts'>, voice?: LogVoice): void {
    const scope = requestScopeSlot.resolver?.()
    const record: LogRecord = { ts: Date.now(), ...fields }
    if (scope) {
        record.trace = scope.trace.traceId
        record.requestSpan = scope.trace.spanId
        record.parentSpan = scope.trace.parentSpanId
        record.elapsedMs = scope.elapsedMs
        record.method = fields.method ?? scope.method
        record.path = fields.path ?? scope.path
    }
    // Hand the finished record to the inspector tap (when installed) before
    // formatting — it observes the same structure the console receives.
    logTapSlot.tap?.(record)
    if (useJson()) {
        printJson(record)
        return
    }
    printTsv(record, voice)
}

/*
One JSON object per line on the level-matched console stream. Undefined
fields drop out of JSON.stringify; non-serialisable `data` degrades to its
String form rather than killing the record.
*/
function printJson(record: LogRecord): void {
    const payload = { ...record, ts: new Date(record.ts).toISOString() }
    let line: string
    try {
        line = JSON.stringify(payload)
    } catch {
        line = JSON.stringify({ ...payload, data: String(record.data) })
    }
    consoleFor(record.level)(line)
}

function consoleFor(level: LogRecord['level']): (...args: unknown[]) => void {
    if (level === 'error') {
        return console.error
    }
    if (level === 'warn') {
        return console.warn
    }
    return console.log
}

/*
The unified tsv line (the default format): tab-separated
`<clock>	<trace8>	<rpc path>	[channel] <message>	+0.00ms`. The
wall-clock leads every line (each record carries `ts`); inside a request scope
the trace column follows and the elapsed-at-emission timing trails; a closing
record emitted outside one (asset hits sidestep the scope) pads a blank trace
column and trails its serve duration instead, so request lines stay aligned
whatever produced them. Every record speaks on a channel
(the app name, 'abide', or a diagnostic channel), shown as a dim `[name]`
tag opening the message field. The method+path pair is one field — it's the
line's anchor unit — and the tag folds into the message field so field
positions stay stable for cut/awk consumers.
*/
function printTsv(record: LogRecord, voice?: LogVoice): void {
    const fields: string[] = []
    const closing = record.status !== undefined
    /* Wall-clock leads every line — a stable first column, unlike the conditional
       trace field, and the axis `+elapsedMs` can't give (when, not how-long). */
    fields.push(dim(formatClock(record.ts)))
    if (record.trace) {
        fields.push(dim(record.trace.slice(0, 8)))
    } else if (closing) {
        fields.push(' '.repeat(8))
    }
    if (record.method && record.path) {
        fields.push(`${colorMethod(record.method)} ${record.path}`)
    }
    const message: string[] = []
    if (record.channel) {
        message.push(dim(`[${record.channel}]`))
    }
    message.push(tsvBody(record, voice))
    fields.push(message.join(' '))
    if (record.elapsedMs !== undefined) {
        fields.push(dim(formatElapsed(record.elapsedMs)))
    } else if (closing && record.durationMs !== undefined) {
        fields.push(dim(formatElapsed(record.durationMs)))
    }
    const writer = consoleFor(record.level)
    if (record.data !== undefined) {
        writer(fields.join('\t'), record.data)
        return
    }
    writer(fields.join('\t'))
}

// The message field after the context fields, styled by level/kind/voice.
function tsvBody(record: LogRecord, voice?: LogVoice): string {
    /* Closing request record: status is the message; the duration rides the elapsed column. */
    if (record.status !== undefined) {
        return colorStatus(record.status)
    }
    /* log.trace operation record: name + settled duration. */
    if (record.name !== undefined && record.durationMs !== undefined) {
        const failure = record.level === 'error' ? ` ${paint('red', record.msg)}` : ''
        return `${record.name} ${dim(`${record.durationMs.toFixed(2)}ms`)}${failure}`
    }
    if (record.level === 'error') {
        return paint('red', record.stack ?? record.msg)
    }
    if (record.level === 'warn') {
        return paint('yellow', record.msg)
    }
    if (voice === 'success') {
        return paint('green', record.msg)
    }
    if (voice === 'detail') {
        return dim(record.msg)
    }
    return record.msg
}
