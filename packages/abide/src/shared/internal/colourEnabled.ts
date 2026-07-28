import { readEnv } from './readEnv.ts'

// colourEnabled(isTerminal) — may this surface use ANSI styling?
//
// The same ladder `logFormat` applies, in the same conventional spellings, so there is no third abide
// name to learn: `NO_COLOR` refuses, `FORCE_COLOR` insists, otherwise it follows whether a person is
// looking at a terminal. What differs is WHICH terminal — `logFormat` asks about `process.stdout`
// because a log line always goes there, while a CLI surface knows its own output stream (an injected
// one under test, the process's own in production). Passing it in is what keeps this usable from a
// reader that was handed a stream, instead of quietly consulting a global that is a pipe in tests.
export function colourEnabled(isTerminal: boolean): boolean {
    const noColour = readEnv('NO_COLOR')
    if (noColour !== undefined && noColour.length > 0) return false
    const forceColour = readEnv('FORCE_COLOR')
    if (forceColour !== undefined && forceColour.length > 0) return true
    return isTerminal
}
