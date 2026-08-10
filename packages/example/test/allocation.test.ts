// Allocation counts on the reactive hot paths, which no demo case can assert.
//
// Not a demo, for the reason `navigation.test.ts` is not one: a case in `demos/` runs the SAME body
// headless and inside a browser card, and `heapStats` comes from `bun:jsc`, which a browser does not
// have. So the claims that need a heap counter live here, where the runtime is always Bun.
//
// What makes these worth asserting at all is that they are invisible: an allocation per write does
// not change a single value the graph produces. The wrong implementation passes every correctness
// test in this repo and costs a garbage collection per list.

import { heapStats } from 'bun:jsc'
import { expect, test } from 'bun:test'
import { channel, memo, state } from 'abide'

/** How many of `kind` the heap holds right now. NOT collected first — see `per`. */
function counted(kind: string): number {
    return (heapStats().objectTypeCounts as Record<string, number>)[kind] ?? 0
}

/**
 * Allocations of `kind` per call of `run`, over `n` calls.
 *
 * Collected ONCE up front and then not again, because what is being counted is garbage: an iterator
 * over an observer set dies immediately, so a collection before the second reading takes the whole
 * measurement back to zero and the assertion passes against either implementation. Asking for
 * retained objects is the wrong question here — the cost of this allocation is that it happens, not
 * that it survives.
 *
 * The risk runs one way: a collection landing mid-loop can only UNDER-count, so this fails safe
 * towards passing. `n` is kept small enough that one is unlikely, and the bound below separates 1.0
 * per call from 0 rather than trying to be exact.
 *
 * Warmed first: the opening calls tier up and allocate shapes the steady state does not.
 */
function per(kind: string, run: (i: number) => void, n: number): number {
    for (let i = 0; i < 20_000; i++) run(i)
    Bun.gc(true)
    const before = counted(kind)
    for (let i = 0; i < n; i++) run(i)
    return (counted(kind) - before) / n
}

const N = 50_000

test('an UNOBSERVED write allocates no iterator', () => {
    // The common shape, not an edge case: the `Async` probe nodes behind every cell are written on
    // each settle and read by nobody, a channel's transcript has no observer until something calls
    // `chunks()`, and a `state` nothing derived from never has one. Walking an empty observer set
    // still allocated its iterator, once per write.
    const cell = state(0)
    expect(per('Set Iterator', (i) => cell.set(i), N)).toBeLessThan(0.5)
})

test('…and a channel publish nobody follows allocates none either', () => {
    const feed = channel<number>({ tail: 64 })
    expect(per('Set Iterator', (i) => feed.publish(i), N)).toBeLessThan(0.5)
})

test('an OBSERVED write still wakes its reader', () => {
    // The guard above returns early on an empty set, so this is what says it returns early on ONLY
    // an empty one — a graph that stopped propagating would pass both tests above.
    const cell = state(0)
    let runs = 0
    const doubled = memo(() => {
        runs++
        return cell() * 2
    })
    expect(doubled()).toBe(0)
    const before = runs
    cell.set(21)
    expect(doubled()).toBe(42)
    expect(runs).toBeGreaterThan(before)
})

// The keyed reconcile's key index is a walk of every previous row, built from INSIDE the per-row
// walk. A row that moved usually moved one place — a swap, an insert, a delete — so the neighbours
// are tried first and the index is what a genuinely scattered pass falls back to.
//
// Counted as Maps rather than timed, because the index is one allocation and the walk that fills it
// is invisible in the output: the same rows end up in the same order either way. A two-row swap is
// the case CLAUDE.md names as the one that distinguishes reconcile implementations, and it is the
// one where indexing all n rows to answer two lookups is pure waste.
test('an adjacent swap builds no key index, and a scattered pass still does', async () => {
    const { html, state } = await import('abide')
    const { container, install, tick } = await import('abide/tests')
    const { keyed, mount } = await import('abide/ui')
    install()

    type Item = { id: number; label: string }
    const base: Item[] = Array.from({ length: 200 }, (_, i) => ({ id: i, label: `r${i}` }))
    const adjacent = base.slice()
    const held = adjacent[1] as Item
    adjacent[1] = adjacent[2] as Item
    adjacent[2] = held
    // Every row far from where it was, which is what the index exists for.
    const scattered = base.map((_, i) => base[(i * 97) % base.length] as Item)

    const mapsPerPass = async (other: Item[]): Promise<number> => {
        const cell = state(base)
        const host = container()
        mount(host, () => html`<ul>${() => cell().map((r) => keyed(r.id, html`<li>${r.label}</li>`))}</ul>`)
        await tick()
        for (let i = 0; i < 50; i++) {
            cell.set(i % 2 ? other : base)
            await tick()
        }
        Bun.gc(true)
        const before = (heapStats().objectTypeCounts as Record<string, number>).Map ?? 0
        const passes = 100
        for (let i = 0; i < passes; i++) {
            cell.set(i % 2 ? other : base)
            await tick()
        }
        const after = (heapStats().objectTypeCounts as Record<string, number>).Map ?? 0
        host.remove()
        return (after - before) / passes
    }

    // A RATIO between the two shapes, not an absolute: `heapStats` counts the whole process, and the
    // awaited ticks let every other suite in the run allocate into the same number. The background
    // rate cancels between two measurements taken the same way; an absolute threshold passed alone
    // and failed inside the full suite, which is the wrong way round for a gate.
    const scatteredMaps = await mapsPerPass(scattered)
    const adjacentMaps = await mapsPerPass(adjacent)
    // The fallback still fires where it earns its keep, so this also says the probe NARROWED the
    // general path rather than removing it.
    expect(scatteredMaps).toBeGreaterThan(0.1)
    expect(adjacentMaps).toBeLessThan(scatteredMaps / 2)
})

// `url('/about')` — a path with no placeholder, already normalised — used to be split into segments
// and rebuilt character-group by character-group to arrive back at the string it started with. Its
// own comment says an href is built per ROW, so that walk was per row of every list of links.
//
// Counted as arrays because that is what the walk leaves behind: `parsePattern` builds a `segments`
// array and a `names` array per call, and neither is cached for a path with no `[` in it (caching
// those would grow the map by one entry per href for the life of the process). The output is the
// same string either way, so nothing but a counter can see the difference.
test('a literal href allocates nothing, and a pattern still parses', async () => {
    const { url } = await import('abide')

    const arraysPerCall = (run: () => string, n: number): number => {
        for (let i = 0; i < 20_000; i++) run()
        Bun.gc(true)
        const before = (heapStats().objectTypeCounts as Record<string, number>).Array ?? 0
        for (let i = 0; i < n; i++) run()
        const after = (heapStats().objectTypeCounts as Record<string, number>).Array ?? 0
        return (after - before) / n
    }

    const literal = arraysPerCall(() => url('/docs/guide/getting-started/install'), 20_000)
    // The comparison has to be another PLACEHOLDER-FREE path, because those are the ones nothing
    // caches — a pattern like `/users/[id]` is parsed once into `PARSED` and then allocates nothing
    // per call either, so it cannot tell the two implementations apart. A trailing slash is the
    // cheapest way to be un-normalised, so this one still takes the walk. A ratio rather than an
    // absolute, for the reason the reconcile gate above is one.
    const walked = arraysPerCall(() => url('/docs/guide/'), 20_000)
    expect(walked).toBeGreaterThan(0.5)
    expect(literal).toBeLessThan(walked / 2)

    // Behaviour is the whole point of the fast path being conservative: anything that is not already
    // exactly what the walk would produce takes the walk.
    expect(url('/docs/guide/getting-started/install')).toBe('/docs/guide/getting-started/install')
    expect(url('/a/b/')).toBe('/a/b')
    expect(url('//a')).toBe('/a')
    expect(url('')).toBe('/')
    expect(url('/users/[id]', { id: 42 })).toBe('/users/42')
})
