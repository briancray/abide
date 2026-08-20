// Allocation counts on the reactive hot paths, which no demo case can assert.
//
// Not a demo, for the reason `navigation.test.ts` is not one: a case in `#shared/demos/` runs the SAME body
// headless and inside a browser card, and `heapStats` comes from `bun:jsc`, which a browser does not
// have. So the claims that need a heap counter live here, where the runtime is always Bun.
//
// What makes these worth asserting at all is that they are invisible: an allocation per write does
// not change a single value the graph produces. The wrong implementation passes every correctness
// test in this repo and costs a garbage collection per list.

import { heapStats } from 'bun:jsc'
import { expect, test } from 'bun:test'
import { channel, memo, state } from 'abide'
import { sleep } from 'harness'

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
    // The common shape, not an edge case: the `Async` probe nodes behind every state are written on
    // each settle and read by nobody, a channel's transcript has no observer until something calls
    // `chunks()`, and a `state` nothing derived from never has one. Walking an empty observer set
    // still allocated its iterator, once per write.
    const held = state(0)
    expect(per('Set Iterator', (i) => held.set(i), N)).toBeLessThan(0.5)
})

test('…and a channel publish nobody follows allocates none either', () => {
    const feed = channel<number>({ tail: 64 })
    expect(per('Set Iterator', (i) => feed.publish(i), N)).toBeLessThan(0.5)
})

test('an OBSERVED write still wakes its reader', () => {
    // The guard above returns early on an empty set, so this is what says it returns early on ONLY
    // an empty one — a graph that stopped propagating would pass both tests above.
    const held = state(0)
    let runs = 0
    const doubled = memo(() => {
        runs++
        return held() * 2
    })
    expect(doubled()).toBe(0)
    const before = runs
    held.set(21)
    expect(doubled()).toBe(42)
    expect(runs).toBeGreaterThan(before)
})

// What licenses every count in this file to be read as THIS test's allocations, rather than as the
// process's: `heapStats` is process-wide, and the only thing that could put somebody else's work
// between two readings is a macrotask running in the gap. It cannot. A loop whose only yields are
// microtask drains never empties the microtask queue, and a timer runs only when it does.
//
// Asserted rather than reasoned about, because it is the premise the `mapsPerPass` estimator below
// rests on: if this ever stopped being true, that measurement would start counting other suites and
// the failure would look like a reconcile regression. A timer set to fire immediately, and a loop of
// exactly the awaits the measurement uses.
test('a timer cannot interleave a loop that only drains microtasks', async () => {
    let fired = 0
    const noise = setInterval(() => fired++, 0)
    try {
        for (let i = 0; i < 100; i++) for (let j = 0; j < 4; j++) await Promise.resolve()
        expect(fired).toBe(0)
    } finally {
        clearInterval(noise)
    }
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
    const { container } = await import('harness')
    const { install, tick } = await import('harness/measure')
    const { keyed } = await import('abide/runtime')
    const { mount } = await import('abide/ui')
    install()

    type Item = { id: number; label: string }
    const base: Item[] = Array.from({ length: 200 }, (_, i) => ({ id: i, label: `r${i}` }))
    const adjacent = base.slice()
    const held = adjacent[1] as Item
    adjacent[1] = adjacent[2] as Item
    adjacent[2] = held
    // Every row far from where it was, which is what the index exists for.
    const scattered = base.map((_, i) => base[(i * 97) % base.length] as Item)

    /**
     * Maps CONSTRUCTED per reconcile pass, counted by standing in front of the constructor.
     *
     * Not `heapStats`, and the reason is the whole history of this case. A census counts what is
     * LIVE, and a key index is garbage the moment the pass that built it ends — so what the census
     * actually reported was how many dead Maps had not been collected yet, which is a coin flip. It
     * failed about one run in four with `scattered` at 0.1 against a true rate of 1.0: a collection
     * inside the loop had taken ninety of the hundred back.
     *
     * Two rounds of statistics were spent on that before the mechanism was read properly. First a
     * RATIO between the arms, on the theory that a background rate cancels — there is no background
     * rate, because a macrotask cannot interleave a loop that only drains microtasks, which the case
     * above asserts. Then the MAX of five trials, on the theory that a collection only deflates so
     * the largest reading is the truest — which is sound, and still loses when every trial contains a
     * collection.
     *
     * Counting constructions has no such failure mode: it is exact, it needs no trials, and a
     * collection cannot reach it. The subclass is installed only around the measured loop and both
     * arms are measured through it, so what it counts is what the reconcile did.
     */
    const mapsPerPass = async (other: Item[]): Promise<number> => {
        const held = state(base)
        const host = container()
        mount(host, () => html`<ul>${() => held().map((r) => keyed(r.id, html`<li>${r.label}</li>`))}</ul>`)
        await tick()
        for (let i = 0; i < 50; i++) {
            held.set(i % 2 ? other : base)
            await tick()
        }

        let built = 0
        const Real = globalThis.Map
        // A SUBCLASS rather than a wrapper function: `new Map(...)` has to keep working for every
        // other caller in the process during the window, `instanceof Map` has to stay true, and a
        // subclass is the only shape that gives both for free.
        class Counted<K, V> extends Real<K, V> {
            constructor(entries?: readonly (readonly [K, V])[] | null) {
                super(entries)
                built++
            }
        }
        const passes = 100
        globalThis.Map = Counted as unknown as MapConstructor
        try {
            for (let i = 0; i < passes; i++) {
                held.set(i % 2 ? other : base)
                await tick()
            }
        } finally {
            globalThis.Map = Real
        }
        host.remove()
        return built / passes
    }

    const scatteredMaps = await mapsPerPass(scattered)
    const adjacentMaps = await mapsPerPass(adjacent)
    // Exact now, so the bounds can be: a scattered pass builds its one index, an adjacent swap builds
    // none. The first is what says the probe NARROWED the general path rather than removing it.
    expect(scatteredMaps).toBeGreaterThanOrEqual(1)
    expect(adjacentMaps).toBe(0)
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
})

// `memo()` compiles INSIDE the setup a render runs, so a declaration is per component instance and
// per REQUEST — a server makes one per request for the life of the process. Each one adds a `WeakRef`
// to a module-global set, and that husk was dropped only by an argless `invalidate()`/`refresh()`:
// user-invoked verbs most apps never call at all. Over 20k renders of a two-memo page that retained
// one husk per declaration and never gave any of it back.
//
// Counted as `WeakRef` rather than as bytes because the husk is exactly one per declaration, so the
// count is exact where a heap delta is noise: the same claim measured in bytes read 65, 221 and 238
// per render across three trials with one 5,588 outlier, and 450 for the implementation that
// actually FIXED it. None of that ambiguity is in this counter — baseline is n, fixed is ~0.
//
// AWAITS AND A TIMER, not a tight loop, and that is the substrate rather than dressing: a
// `FinalizationRegistry` callback runs on a turn of the event loop, so a synchronous loop with a
// forced collection at the end reclaims NOTHING and reads identically to the leak. It has to be given
// the turn a server gets between requests.
test('a declaration drops its husk when collected, so a per-request memo is bounded', async () => {
    // NOT named `declare`: at statement position TypeScript reads that as an ambient declaration and
    // the transpiler ERASES the call with the statements after it — the loop ran as nothing, the
    // counts read 0, and the gate passed against the leak it was written to catch.
    const declareMemo = (await import('abide')).memo
    const husks = (): number => counted('WeakRef')
    const settle = async (): Promise<void> => {
        Bun.gc(true)
        await sleep(50)
        Bun.gc(true)
    }

    const retainedOver = async (n: number): Promise<number> => {
        await settle()
        const before = husks()
        for (let i = 0; i < n; i++) {
            declareMemo(() => i)
            // The yield a request boundary is; nothing holds the memo past it.
            if ((i & 0xff) === 0xff) await Promise.resolve()
        }
        await settle()
        return husks() - before
    }

    // Two sizes of the same structure, each against the declarations that made it: what the registry
    // buys is that retention does NOT scale with n. A ratio between the arms is the wrong shape —
    // the fixed count is 0, and 0 tells nothing apart from 0.
    //
    // An eighth of one husk per declaration separates "bounded" from the one-each of the revert with
    // room to spare, and leaves slack for the handful in flight when the last collection ran.
    expect(await retainedOver(2_000)).toBeLessThan(2_000 / 8)
    expect(await retainedOver(16_000)).toBeLessThan(16_000 / 8)
})
