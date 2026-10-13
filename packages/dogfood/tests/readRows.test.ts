// THE RUNNER'S OWN FAILURE REACHES THE BOARD. A runner that dies after its first rows cannot fail the
// stream with a status — its head went out with the first row — so the docs app writes a `failure`
// line after what it did send, and `readRows` rejects with it. THE REVERT: hand every parsed line to
// `each`; the failure is taken for a row, the read resolves, and the board says nothing went wrong.

import { expect, test } from 'bun:test'
import { readRows } from '#src/instruments/lib/readRows.ts'

test("a runner's failure after its rows rejects the read with its own message", async () => {
    const lines = `${JSON.stringify({ id: 'a', state: 'done' })}\n${JSON.stringify({ failure: 'testRows.ts exited 1\nboom' })}\n`
    const seen: string[] = []
    let failure = ''
    try {
        await readRows<{ id: string }>(new Response(lines), (row) =>
            seen.push(row.id),
        )
    } catch (thrown) {
        failure = (thrown as Error).message
    }
    expect(seen).toEqual(['a'])
    expect(failure).toBe('testRows.ts exited 1\nboom')
})

// A LAST ROW WITH NO NEWLINE AFTER IT IS STILL A ROW. THE REVERT: return on `done` without parsing
// what is buffered; `b` never reaches `each`, and nothing says it was dropped.
test('a final row with no trailing newline is handed over', async () => {
    const lines = `${JSON.stringify({ id: 'a' })}\n${JSON.stringify({ id: 'b' })}`
    const seen: string[] = []
    await readRows<{ id: string }>(new Response(lines), (row) =>
        seen.push(row.id),
    )
    expect(seen).toEqual(['a', 'b'])
})

// A BLANK LINE IS SKIPPED, NOT CONSUMED. THE REVERT: `continue` past a blank line without finding
// the next newline; each pass eats one character as another blank line, and once the buffer is
// empty the loop spins synchronously — the file HANGS rather than failing.
test('a blank line between rows is skipped', async () => {
    const lines = `${JSON.stringify({ id: 'a' })}\n\n${JSON.stringify({ id: 'b' })}\n`
    const seen: string[] = []
    await readRows<{ id: string }>(new Response(lines), (row) =>
        seen.push(row.id),
    )
    expect(seen).toEqual(['a', 'b'])
})
