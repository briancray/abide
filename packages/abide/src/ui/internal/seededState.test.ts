// §5 state-initializer record/replay — CLIENT REPLAY + CALL-ORDER ALIGNMENT (Stage 2, PR2).
//
// `makeSeededState(seed)` wraps the real `state` so the Nth `state()` call on a mount consumes
// `seed.states[N]` as its initial. These tests pin the ordinal contract (consume in order, fall back
// when unseeded/overflowed, re-apply transform to the raw seed) and the load-bearing call-order
// alignment: the emitted SERVER setup and CLIENT setup call `state()` in the SAME source order
// (module `<script module>` before instance `<script>`), so a recorded seed replays by ordinal.

import { expect, test } from 'bun:test'
import type { HydrationSeed } from '../../server/internal/pages.ts'
import { encode } from '../../shared/internal/codec.ts'
import type { State, StateCell } from '../../shared/state.ts'
import { state } from '../../shared/state.ts'
import { loadEmitted } from './emit.ts'
import { makeSeededState } from './seededState.ts'

// The wire seed carries `states` as the rich-codec encoding of the per-component buckets (pages.ts).
function seed(buckets: unknown[][]): HydrationSeed {
    return { states: encode(buckets) }
}

test('consumes seed.states by ordinal, in call order', () => {
    const s = makeSeededState(seed([[10, 20, 30]]))
    expect(s(1).peek()).toBe(10)
    expect(s(2).peek()).toBe(20)
    expect(s(3).peek()).toBe(30)
})

test('falls back to the literal initial when the ordinal overflows the seed', () => {
    const s = makeSeededState(seed([[10]]))
    expect(s(1).peek()).toBe(10)
    expect(s(2).peek()).toBe(2) // no seed slot 1 → literal initial
})

test('falls back to the literal initial when the seed carries no states', () => {
    const s = makeSeededState({})
    expect(s(7).peek()).toBe(7)
    expect(s(8).peek()).toBe(8)
})

test("re-applies the page's transform to the RAW seed value (matches the server cell)", () => {
    // Server recorded the raw initial 5; the client passes transform through, reaching 6 (== server cell).
    const s = makeSeededState(seed([[5]]))
    const cell = s(0, (v: number) => v + 1)
    expect(cell.peek()).toBe(6)
})

test('transform still applies to later writes on a seeded cell', () => {
    const s = makeSeededState(seed([[5]]))
    const cell = s(0, (v: number) => v + 1)
    cell.write(10)
    expect(cell.peek()).toBe(11)
})

test('.computed / .linked pass through and do NOT advance the ordinal', () => {
    const s = makeSeededState(seed([[100, 200]]))
    const c = s.computed(() => 1) // must not consume a state slot
    expect(c.peek()).toBe(1)
    // The next plain state() still consumes ordinal 0, proving computed did not advance it.
    expect(s(0).peek()).toBe(100)
    expect(s(0).peek()).toBe(200)
})

// A recording `state` for the SERVER side of the round-trip: pushes each raw initial in call order.
function recordingState(recorded: unknown[]): State {
    return Object.assign(
        function record<T>(initial: T, transform?: (value: T) => T): StateCell<T> {
            recorded.push(initial)
            return state(initial, transform)
        } as State,
        { computed: state.computed, linked: state.linked },
    )
}

test('server records and client replays module + instance state in the SAME order', async () => {
    // Unique source → fresh emitted module (its `$module` memo has not run yet), so the module
    // `<script module>` setup runs on both the first server render and the first client mount.
    const source =
        "<script module>import { state } from 'abide/shared/state'; let g = state('M')</script>" +
        "<script>import { state } from 'abide/shared/state'; let i = state('I')</script>" +
        '<p>{g}-{i}</p>'
    const emitted = await loadEmitted(source)

    // SERVER: record the call order of state() during the emitted `render`.
    const recorded: unknown[] = []
    await emitted.render({ state: recordingState(recorded) })
    expect(recorded).toEqual(['M', 'I']) // module first, then instance

    // CLIENT: replay a DISTINCT seed by ordinal — module (call 0) → "X", instance (call 1) → "Y".
    const host = document.createElement('div')
    const dispose = emitted.mount(host, { state: makeSeededState(seed([['X', 'Y']])) })
    expect(host.textContent).toBe('X-Y')
    dispose()
})
