// The human-facing server log line: fixed columns, colour, no wasted width.
//
//   14:22:09.318 warn  abide:identity ABIDE_IDENTITY_SECRET is not set — …  8f144e88
//   └ local time  └ level └ channel   └ message                            └ trace
//
// Three deliberate compressions against the TSV line, each buying horizontal room for the part that
// carries the meaning (the message):
//   * LOCAL wall-clock time, no date — a terminal log is read as it happens; the ISO instant survives
//     in `ABIDE_LOG_FORMAT=json`, which is what a collector consumes.
//   * the traceparent shrinks to the first 8 hex of its TRACE id (55 chars → 9) and moves to the end.
//     That is enough to eyeball "these lines are one request"; the full W3C value stays in json.
//   * a multi-line message (an Error stack) indents + dims its continuation lines, so the stack reads
//     as an attachment to the line above rather than as more log lines.

import { logChannelColor } from './logChannelColor.ts'

const CHANNEL_COLUMN = 14
const LEVEL_COLUMN = 5

const RESET = '\x1b[0m'
const DIM = '\x1b[2m'

// `log` is deliberately unstyled — it is the app's own stream, and the framework's levels should not
// out-shout it.
const LEVEL_STYLE: Record<string, string> = {
    error: '\x1b[1;31m',
    warn: '\x1b[33m',
    info: '\x1b[36m',
    log: '',
    trace: '\x1b[2;35m',
}

function paint(style: string, text: string): string {
    return style.length === 0 ? text : `${style}${text}${RESET}`
}

function localTime(time: Date): string {
    const hours = String(time.getHours()).padStart(2, '0')
    const minutes = String(time.getMinutes()).padStart(2, '0')
    const seconds = String(time.getSeconds()).padStart(2, '0')
    const millis = String(time.getMilliseconds()).padStart(3, '0')
    return `${hours}:${minutes}:${seconds}.${millis}`
}

export function prettyLogLine(
    level: string,
    channel: string,
    message: string,
    traceparent: string | undefined,
    time: Date,
): string {
    const style = LEVEL_STYLE[level] ?? ''
    const parts = [
        paint(DIM, localTime(time)),
        paint(style, level.padEnd(LEVEL_COLUMN)),
        paint(logChannelColor(channel).ansi, channel.padEnd(CHANNEL_COLUMN)),
    ]

    // An error's own text is the payload of the line, so it carries the level's colour too; every
    // other level leaves the message plain and lets the badge do the signalling.
    const lines = message.split('\n')
    const head = lines[0] ?? ''
    parts.push(level === 'error' ? paint('\x1b[31m', head) : head)

    if (traceparent !== undefined) {
        // `00-<32 hex trace id>-<16 hex span id>-<flags>` — the trace id starts at index 3. Set off from
        // the message by a double space and dimmed, with no marker glyph: the id is for correlating
        // lines, and anything that reads as punctuation there reads as part of the message.
        parts.push(paint(DIM, ` ${traceparent.slice(3, 11)}`))
    }

    let line = parts.join(' ')
    for (let index = 1; index < lines.length; index++) {
        line += `\n${paint(DIM, `    ${lines[index]}`)}`
    }
    return line
}
