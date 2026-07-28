// One log record → one output line, in whichever of the three shapes `logFormat()` selected.
//
// Extracted from `log.ts` so the REMOTE tail (`logs`, reading records off `/__abide/logs`) renders
// through the same code the server's own stdout does. That is not deduplication for its own sake: the
// whole claim of the `logs` subcommand is that watching a deployment looks exactly like watching the
// process, and two formatters would make that claim true only until one of them was edited.

import { prettyLogLine } from './prettyLogLine.ts'

export function formatLogLine(
    level: string,
    channel: string,
    message: string,
    traceparent: string | undefined,
    time: Date,
    format: 'json' | 'tsv' | 'pretty',
): string {
    if (format === 'pretty') return prettyLogLine(level, channel, message, traceparent, time)

    if (format === 'json') {
        const record: {
            level: string
            time: string
            channel: string
            traceparent?: string
            message: string
        } = {
            level,
            time: time.toISOString(),
            channel,
            message,
        }
        if (traceparent !== undefined) record.traceparent = traceparent
        return JSON.stringify(record)
    }

    const parts = [level, time.toISOString(), `[${channel}]`]
    if (traceparent !== undefined) parts.push(traceparent)
    parts.push(message)
    return parts.join('\t')
}
