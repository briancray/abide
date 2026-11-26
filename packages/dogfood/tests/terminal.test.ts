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
