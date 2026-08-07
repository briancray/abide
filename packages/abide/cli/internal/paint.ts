// The four codes this binary writes with, and where the ANSI question is answered.
//
// One answer for the usage screen, the REPL banner and the REPL's ghost text, because `NO_COLOR` is
// one promise rather than three — and it is `colourAllowed`'s answer, the same one the log line's
// shape is decided by. Only the ORDERING is shared: `ABIDE_LOG_FORMAT=json` says how a MACHINE reads
// log records and has nothing to say about whether a help screen a person asked for is coloured, so
// `logShape` is deliberately not asked here.

export { colourAllowed as coloured } from '$shared/internal/env.ts'

export const DIM = '\x1b[90m'
export const BOLD = '\x1b[1m'
export const RED = '\x1b[31m'
export const OFF = '\x1b[0m'

/** Wrap in a code, or hand the text back untouched. The one branch, so no caller repeats it. */
export function paint(text: string, code: string, on: boolean): string {
    return on ? `${code}${text}${OFF}` : text
}
