import { expect, test } from 'bun:test'
import { receiveStreamedCell, registerStreamedCell } from '../src/lib/ui/runtime/STREAMED_CELLS.ts'

/*
ADR-0035 — a streaming cell's server-resolved value is applied POST-hydration, never during the
synchronous mount. The `__abideResolve` chunk parses (buffering the value) BEFORE the client mounts,
so applying it synchronously at registration would set the cell to the resolved value while the SSR
DOM still shows the pending text — an `assertClaimedText` desync (caught in the browser during
development; these guard the microtask deferral that fixes it). Both orderings — value-before-cell
(buffered) and cell-before-value (live) — must defer.
*/

test('a buffered streamed value (arrived before mount) applies in a microtask, not synchronously', async () => {
    receiveStreamedCell('adr35-buffered', 'streamed-value')
    let applied: unknown = 'NOT_APPLIED'
    registerStreamedCell('adr35-buffered', (value) => {
        applied = value
    })
    /* Synchronous check == the claim moment during hydration: the value must NOT be applied yet, so
       the cell still reads pending and claims the SSR pending markup congruently. */
    expect(applied).toBe('NOT_APPLIED')
    await Promise.resolve()
    expect(applied).toBe('streamed-value')
})

test('a streamed value arriving after registration (live) also defers to a microtask', async () => {
    let applied: unknown = 'NOT_APPLIED'
    registerStreamedCell('adr35-live', (value) => {
        applied = value
    })
    receiveStreamedCell('adr35-live', 42)
    expect(applied).toBe('NOT_APPLIED')
    await Promise.resolve()
    expect(applied).toBe(42)
})

test('each key is delivered once (one-shot)', async () => {
    let count = 0
    registerStreamedCell('adr35-once', () => {
        count += 1
    })
    receiveStreamedCell('adr35-once', 'x')
    receiveStreamedCell('adr35-once', 'x') // no registered apply left → buffered, not re-applied
    await Promise.resolve()
    expect(count).toBe(1)
})
