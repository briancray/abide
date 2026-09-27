// THE RUNNER'S OWN FAILURE REACHES THE BOARD. A runner that dies after its first rows cannot fail the
// stream with a status — its head went out with the first row — so the docs app writes a `failure`
// line after what it did send, and `readRows` rejects with it. THE REVERT: hand every parsed line to
// `each`; the failure is taken for a row, the read resolves, and the board says nothing went wrong.

import { expect, test } from 'bun:test'
import { readRows } from '#ui/readRows.ts'

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
