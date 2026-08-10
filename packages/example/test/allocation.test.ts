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
