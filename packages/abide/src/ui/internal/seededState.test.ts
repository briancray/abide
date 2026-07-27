// §5 state-initializer record/replay — CLIENT REPLAY + CALL-ORDER ALIGNMENT (Stage 2, PR2).
//
// `makeSeededState(seed)` wraps the real `state` so the Nth `state()` call in a bucket consumes that
// bucket's Nth value as its initial. Buckets are keyed by SITE PATH (`""` = the page/root; `/<siteId>`
// per `<Component/>`; `#<index>` per `{#for}` item) rather than by mount order. These tests pin the
// ordinal contract within a bucket (consume in order, fall back when unseeded/overflowed, re-apply
// transform to the raw seed) and the load-bearing call-order alignment: the emitted SERVER setup and
// CLIENT setup call `state()` in the SAME source order (module `<script module>` before instance
// `<script>`), so a recorded bucket replays by ordinal.

import { expect, test } from 'bun:test'
import { encode } from '../../shared/internal/codec.ts'
import type { HydrationSeed } from '../../shared/internal/hydrationSeed.ts'
import { memo } from '../../shared/memo.ts'
import type { State, StateFactory } from '../../shared/state.ts'
import { state } from '../../shared/state.ts'
import { loadEmitted } from './emit.ts'
import { makeSeededState } from './seededState.ts'

// The wire seed carries `states` as the rich-codec encoding of the site-keyed bucket map (pages.ts).
// These tests drive the ROOT bucket, whose site path is the empty string.
function seed(buckets: unknown[][]): HydrationSeed {
    const map: Record<string, unknown[]> = {}
    const root = buckets[0]
    if (root !== undefined) map[''] = root
    for (let i = 1; i < buckets.length; i++) {
        const bucket = buckets[i]
        if (bucket !== undefined) map[`/${i - 1}`] = bucket
    }
    return { states: encode(map) }
}

test('consumes seed.states by ordinal, in call order', () => {
    const s = makeSeededState(seed([[10, 20, 30]]))
    expect(s(1).untracked()).toBe(10)
    expect(s(2).untracked()).toBe(20)
    expect(s(3).untracked()).toBe(30)
})

test('falls back to the literal initial when the ordinal overflows the seed', () => {
    const s = makeSeededState(seed([[10]]))
    expect(s(1).untracked()).toBe(10)
    expect(s(2).untracked()).toBe(2) // no seed slot 1 → literal initial
})

// A `{#for}` ITERATION opens its own bucket, so a branch-local `<script>`'s cells are per item.
//
// While a loop body could hold no `state()` of its own, sharing the enclosing bucket was safe: only a
// nested `<Component/>` recorded, and that branched by site anyway. A branch-local `<script>` breaks
// that assumption — its cells record once PER ITERATION into one ordinal sequence, so an item that
// mounts out of order (a `{#for await}` re-drains asynchronously on the client) would consume the
// neighbour's slot and replay its value, with the DOM structurally fine and nothing to catch it.
test('each {#for} iteration replays its OWN bucket, not the next item’s slot', () => {
    // `forSite`/`forItem` are seed plumbing the emitted code reaches dynamically, so they are not on the
    // public `StateFactory` — name the shape here rather than widening it for everyone.
    type SeedFactory = StateFactory & { forItem(index: number): SeedFactory }
    const map: Record<string, unknown[]> = { '#0': ['first'], '#1': ['second'] }
    const s = makeSeededState({ states: encode(map) } as HydrationSeed) as SeedFactory

    // Item 1 replayed BEFORE item 0 — the asynchronous-remount order a shared ordinal cursor cannot
    // survive. Keyed by item, each still lands on its own value.
    expect(s.forItem(1)('fallback').untracked()).toBe('second')
    expect(s.forItem(0)('fallback').untracked()).toBe('first')
})

test('falls back to the literal initial when the seed carries no states', () => {
    const s = makeSeededState({})
    expect(s(7).untracked()).toBe(7)
    expect(s(8).untracked()).toBe(8)
})

test("re-applies the page's transform to the RAW seed value (matches the server cell)", () => {
    // Server recorded the raw initial 5; the client passes transform through, reaching 6 (== server cell).
    const s = makeSeededState(seed([[5]]))
    const cell = s(0, (v: number) => v + 1)
    expect(cell.untracked()).toBe(6)
})

test('transform still applies to later writes on a seeded cell', () => {
    const s = makeSeededState(seed([[5]]))
    const cell = s(0, (v: number) => v + 1)
    cell.set(10)
    expect(cell.untracked()).toBe(11)
})

test('a derivation never consumes a seed slot (ADR 0024: derivation is memo, not state)', () => {
    const s = makeSeededState(seed([[100, 200]]))
    // A `memo` is not a `state` call at all, so it cannot advance the per-component ordinal.
    const derived = memo(() => 1)
    expect(derived()).toBe(1)
    expect(s(0).untracked()).toBe(100)
    expect(s(0).untracked()).toBe(200)
})

// A recording `state` for the SERVER side of the round-trip: pushes each raw initial in call order.
function recordingState(recorded: unknown[]): StateFactory {
    return Object.assign(
        function record<T>(initial: T, transform?: (value: T) => T): State<T> {
            recorded.push(initial)
            return state(initial, transform)
        } as StateFactory,
        { shared: state.shared },
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

// SITE-KEYED BUCKETS — the mount-ORDER regression (the reason buckets stopped being an array).
//
// A `{#for await}` region is discarded on hydrate and re-created ASYNCHRONOUSLY (runtime.forBlock clears
// it, then drains in a microtask). With a mount-order counter the SERVER counted each streamed item's
// component in document order while the CLIENT did not count them at all during the sync hydrate pass —
// so every component AFTER the block was assigned a different bucket id on each side and silently
// replayed the WRONG component's state. No hydration mismatch fires: the DOM structure is fine, only the
// value is wrong. Site paths are computed from the template, so they cannot shift with mount timing.
const SEED_A = `<script>import { state } from "abide/shared/state"; let n = state("A-initial")</script><b class="a">{n}</b>`
const SEED_B = `<script>import { state } from "abide/shared/state"; let n = state("B-initial")</script><i class="b">{n}</i>`
const seedResolve = (specifier: string): string | undefined =>
    specifier === './A.abide' ? SEED_A : specifier === './B.abide' ? SEED_B : undefined

function streamOfTwo(): AsyncIterable<number> {
    return {
        async *[Symbol.asyncIterator]() {
            yield 1
            yield 2
        },
    }
}

test('a component AFTER a {#for await} replays its OWN bucket, not a streamed item’s', async () => {
    const source =
        `<script>import A from "./A.abide"; import B from "./B.abide"</script>` +
        `<div>{#for await x of src}<A/>{/for}<B/></div>`
    const emitted = await loadEmitted(source, seedResolve)

    // Server: record initials exactly as `pages.makeRecordingState` does, keyed by site path.
    const buckets: Record<string, unknown[]> = {}
    function recorderAt(sitePath: string, bucketPath: string): StateFactory {
        let bucket = buckets[bucketPath]
        if (bucket === undefined) {
            bucket = []
            buckets[bucketPath] = bucket
        }
        const owned = bucket
        const rec = ((initial: unknown, transform?: (v: unknown) => unknown) => {
            owned.push(initial)
            return state(initial, transform as never)
        }) as unknown as Record<string, unknown>
        // Mirrors `pages.makeRecordingState` — keep the two in step: this is the SERVER half of the
        // contract, and a copy that drifts from it tests a recorder no page ever uses.
        return Object.assign(rec, {
            shared: state.shared,
            forSite: (id: number) => recorderAt(`${sitePath}/${id}`, `${sitePath}/${id}`),
            forItem: (i: number) => recorderAt(`${sitePath}#${i}`, `${sitePath}#${i}`),
        }) as unknown as StateFactory
    }
    const html = await emitted.render({ src: streamOfTwo(), state: recorderAt('', '') })
    expect(html).toContain('B-initial')
    // The CONTRACT, asserted directly: every bucket key is a SITE PATH. `<A/>` is site 0 and gets one
    // bucket PER LOOP ITEM (`#0/0`, `#1/0`); `<B/>` is site 1 and is keyed by its site alone (`/1`) — no
    // positional id that a streamed item could shift. `""` is the page/root bucket, and `#0`/`#1` are the
    // iterations' own (empty here — this loop body declares no state of its own; a branch-local
    // `<script>` is what fills them, which is why an item opens a bucket rather than sharing one).
    expect(Object.keys(buckets).sort()).toEqual(['', '#0', '#0/0', '#1', '#1/0', '/1'])

    const host = document.createElement('div')
    host.innerHTML = html
    emitted.hydrate(host, {
        src: streamOfTwo(),
        state: makeSeededState({ states: encode(buckets) } as HydrationSeed),
    })
    for (let i = 0; i < 8; i++) await Promise.resolve()

    // The load-bearing assertion: B still shows ITS OWN seeded value. Under the old mount-order counter
    // this read a streamed item's bucket and rendered "A-initial".
    const b = host.querySelector('.b')
    expect(b?.textContent).toBe('B-initial')
})
