// 40.46 — THE DOCS RUN ONLY THE COMMANDS THEY LIST: a command a browser sends that the terminal does not
// list is refused before anything is spawned.

import { expect, test } from 'bun:test'

import { servedDocs } from './docsPages.ts'

// THE REVERT: drop the `return` before `refuse` in `transcript` (lib/Terminal.abide); the refusal is
// built and discarded, the command runs, and `abide --version` answers 200 where 404 is due.
test('a command the terminal does not list is refused, and runs nothing — 40.46', async () => {
    const { base } = await servedDocs()
    const answer = await fetch(
        `${base}/__abide/handlers/lib/Terminal/transcript?command=${encodeURIComponent('abide --version')}`,
    )
    expect(answer.status).toBe(404)
}, 30_000)

// 40.45 — A LISTED COMMAND RUNS, answering what it printed and exited with, through the memo that
// keeps it per process. THE REVERT: return the memo's entry rather than calling it, and the answer
// is not the transcript — a 500 where `200 number true` is due.
test('a command the terminal lists runs and answers its transcript — 40.45', async () => {
    const { base } = await servedDocs()
    const answer = await fetch(
        `${base}/__abide/handlers/lib/Terminal/transcript?command=${encodeURIComponent('abide-bridge')}`,
    )
    const { output, code } = (await answer.json()) as {
        output: string
        code: number
    }
    expect(`${answer.status} ${typeof code} ${output.length > 0}`).toBe(
        '200 number true',
    )
}, 60_000)
