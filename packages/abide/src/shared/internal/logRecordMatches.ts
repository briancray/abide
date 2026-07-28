// Does one log record pass a subscriber's filter? Applied SERVER-SIDE, before the record reaches the
// wire — a chatty app would otherwise spend the whole feed's bandwidth on lines the reader discards.
//
// The channel filter is the `DEBUG` grammar itself (`debugPatternMatches`), so `DEBUG=abide:rpc` on the
// server and `logs --debug abide:rpc` from a laptop select the same lines with the same spelling.

import { debugPatternMatches } from './debugPatternMatches.ts'
import type { LogRecord } from './logFeed.ts'

// A FLOOR, so `--level warn` means warn-and-worse. `log` and `info` share a rank: `log` is the app's
// own stream and `info` the framework's equivalent, and no reader has ever wanted one without the
// other. `trace` sits below both because it is the firehose.
const SEVERITY: Record<string, number> = {
    trace: 0,
    log: 1,
    info: 1,
    warn: 2,
    error: 3,
}

export interface LogFilter {
    // Severity floor; 0 admits everything.
    level: number
    // `DEBUG`-grammar channel pattern. Undefined = every channel.
    debug: string | undefined
    // A trace id, or any PREFIX of one. Undefined = every trace.
    trace: string | undefined
}

export function logRecordMatches(record: LogRecord, filter: LogFilter): boolean {
    if (filter.level > 0 && (SEVERITY[record.level] ?? 1) < filter.level) return false
    if (filter.debug !== undefined && !debugPatternMatches(filter.debug, record.channel))
        return false
    if (filter.trace !== undefined) {
        const traceparent = record.traceparent
        if (traceparent === undefined) return false
        // `00-<32 hex trace id>-<16 hex span id>-<flags>`. Matching a PREFIX is what makes the 8 hex
        // the pretty line prints directly paste-able into `--trace`.
        if (!traceparent.slice(3, 35).startsWith(filter.trace)) return false
    }
    return true
}

// Parse a filter off the subscribe URL. Every field is optional and an unparseable one is simply not
// applied — a log tail that 400s because a level was misspelled is worse than one that shows too much.
export function logFilterFromParams(params: URLSearchParams): LogFilter {
    const level = params.get('level')
    const debug = params.get('debug')
    const trace = params.get('trace')
    return {
        level: level === null ? 0 : (SEVERITY[level] ?? 0),
        debug: debug === null || debug === '' ? undefined : debug,
        trace: trace === null || trace === '' ? undefined : trace.toLowerCase(),
    }
}
