// THE CLI'S MACHINE-READABLE FAILURE ENVELOPES.
//
// Every command writes its errors to stderr as a JSON object (MS3.4), and two of those objects are not
// a command's own business but the CLI's contract with whatever is reading it: `unreachable` (nothing
// answered at the target) and `stream-interrupted` (a line-stream died mid-flight). Three commands had
// written the first out verbatim (`logsCommand`, `callCliCommand`, `identityCommand`) and two the
// second, so a change to either shape would have given a script two spellings of one failure.
//
// The exit code travels with the shape deliberately: both of these are `failed`, and separating "what
// it printed" from "what it exited with" is how the two drift.

import { CLI_EXIT_CODES } from './CLI_EXIT_CODES.ts'

function messageOf(caught: unknown): string {
    return caught instanceof Error ? caught.message : String(caught)
}

// Nothing answered at `origin`. `writeError` takes the line so this stays usable from the REPL, which
// captures both streams.
export function reportUnreachable(
    origin: string,
    caught: unknown,
    writeError: (text: string) => void,
): number {
    writeError(
        `${JSON.stringify({ error: 'unreachable', target: origin, message: messageOf(caught) })}\n`,
    )
    return CLI_EXIT_CODES.failed
}

// A jsonl/sse line-stream ended in a throw rather than an EOF.
export function reportStreamInterrupted(
    caught: unknown,
    writeError: (text: string) => void,
): number {
    writeError(`${JSON.stringify({ error: 'stream-interrupted', message: messageOf(caught) })}\n`)
    return CLI_EXIT_CODES.failed
}
