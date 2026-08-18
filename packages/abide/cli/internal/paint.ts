// The four codes this binary writes with, and where the ANSI question is answered.
//
// One answer for the usage screen, the REPL banner and the REPL's ghost text, because `NO_COLOR` is
// one promise rather than three — and it is `colorAllowed`'s answer, the same one the log line's
// shape is decided by. Only the ORDERING is shared: `ABIDE_LOG_FORMAT=json` says how a MACHINE reads
// log records and has nothing to say about whether a help screen a person asked for is colored, so
// `logShape` is deliberately not asked here.

export { colorAllowed as colored } from '#shared/internal/env.ts'

export const DIM = '\x1b[90m'
export const BOLD = '\x1b[1m'
export const RED = '\x1b[31m'
export const OFF = '\x1b[0m'

/** Wrap in a code, or hand the text back untouched. The one branch, so no caller repeats it. */
export function paint(text: string, code: string, on: boolean): string {
    return on ? `${code}${text}${OFF}` : text
}

/** `1 page`, `2 pages`. Here beside `paint` because every command's report line counts something. */
export function plural(count: number, word: string): string {
    return `${count} ${word}${count === 1 ? '' : 's'}`
}

/**
 * A two-column screen: the left column padded to the widest entry, the right one dim.
 *
 * The width comes off the rows rather than a constant, so a longer name lines the column up instead
 * of breaking it — the one piece of formatting worth computing, because it is the one a hand-written
 * screen always gets wrong first. Here rather than in either table, because there are two of them:
 * `COMMANDS.ts` is this binary's subcommands and `ACTIONS.ts` is the console's, and a column that
 * lined up differently between them would be two answers to one question.
 */
export function aligned(rows: [string, string][], on: boolean): string[] {
    let width = 0
    for (const [left] of rows) if (left.length > width) width = left.length
    const lines: string[] = []
    for (const [left, right] of rows) lines.push(`  ${left.padEnd(width)}  ${paint(right, DIM, on)}`)
    return lines
}
