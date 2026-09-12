// D69'S DERIVED PROBES, and the two counts that say the mechanism is the one 11.22
// ordered rather than a subscription per source wearing its name.

import { expect, test } from 'bun:test'
import { measure, type Work } from 'harness/measure'
import { memo, state, watch } from '#shared/index.ts'
import { publishWork } from '#shared/reactive/counters.ts'
import { flushEffects } from '#shared/reactive/graph.ts'

// 12.12 — A WRITE SCHEDULES ITS READERS RATHER THAN RUNNING THEM, so the op every case
// here measures is the write plus the tick that delivers it. `measure()` takes a
// synchronous body and this lane may not import abide to drain the queue itself (44.1),
// so the drain is spelled once here and every case reaches for it. Written as the op
// rather than as two lines per case: a case that forgot the drain would report zero
// wakes and pass every "does less work" assertion vacuously.
const measureSettled = (body: () => void): Work =>
    measure(() => {
        body()
        flushEffects()
    })


publishWork()

// A k-deep, 2-wide layer chain: k − 1 layers of two memos each over a bottom layer of
// two states, with one memo on top reading the first layer. Every node is reachable by
// two paths from the top, which is what makes the mark load-bearing.
function layered(depth: number): {
    top: ReturnType<typeof memo>
    slow: ReturnType<typeof state>
} {
    const settled = state(1)
    const slow = state(new Promise<number>(() => {}))
    let below: [() => unknown, () => unknown] = [settled, slow]
    for (let layer = 1; layer < depth; layer += 1) {
        const [first, second] = below
        below = [
            memo(() => (first() as number) + (second() as number)),
            memo(() => (first() as number) - (second() as number)),
        ]
    }
    const [first, second] = below
    return {
        top: memo(() => (first() as number) * (second() as number)),
        slow,
    }
}

// REVERT: drop `source.walk` and the mark test from `propagated`. REPORTS: 510 nodes
// visited at k = 8 where this asserts 16 — a node reachable by two paths is descended
// twice, and a chain of k such layers is 2^(k+1) − 2. The short-circuit hides it
// exactly when the answer is `true`, so the cost only appears on the `false` reads,
// which are the common ones.
test('a probe over a k-deep 2-wide layer chain descends 2k nodes', () => {
    const { top } = layered(8)
    // The bodies have to have run for the walk to have a source list to walk.
    top()
    const work = measureSettled(() => {
        top.refreshing()
    })
    expect(work.descents).toBe(16)
})

// The positive half, and it is a different case rather than a second assertion: the
// count above is taken on a `false` read, which is what the walk pays for in full. A
// gate that only ever measured the short-circuited read would report 1 and be green
// against a walk that does nothing.
test('a propagated probe still answers true through the whole chain', () => {
    const { top } = layered(8)
    top()
    expect(top.pending()).toBe(true)
})

// REVERT: hold a subscription per source for a propagated probe — have `propagated`
// `attach` each source to the MEMO's own reader instead of letting `subscribe` land
// the edge on the reader that asked. REPORTS: 1 per source where this asserts 0,
// which 11.22 is exactly the refusal of.
//
// THE PROBE HAS TO REACH THE WALK, which `pending` over a memo whose body has not
// produced does not: 11.61 leaves the memo's OWN `PENDING` bit set and the probe
// answers from it without descending anywhere. So the memo here has landed a value
// and its source is revalidating over it (3.14), which is the case the walk exists
// for.
test('an unkeyed memo holds zero probe subscriptions of its own', () => {
    const source = state(1)
    const derived = memo(() => source())
    derived()
    source.set(new Promise<number>(() => {}))
    const work = measureSettled(() => {
        watch(() => {
            derived.refreshing()
        })
    })
    expect(work.subscriptions).toBe(0)
    // The positive half. Zero probe subscriptions also passes against a memo that
    // derives nothing at all, so the probe has to be answering `true` through a
    // source it holds no edge on.
    expect(derived.refreshing()).toBe(true)
})

// 11.22 buys "hold no subscription" and the reader pays for the walk on every read.
// The count is not the cost and this plan owes the second number — `{#if m.pending()}`
// inside a 500-row list walks the transitive source graph 500 times a frame — so what
// is asserted here is that the walk is LINEAR in the graph and not that it is free.
test('a probe read walks each node once however many readers ask', () => {
    const { top } = layered(4)
    top()
    const once = measureSettled(() => {
        top.refreshing()
    })
    const twice = measureSettled(() => {
        top.refreshing()
        top.refreshing()
    })
    expect(once.descents).toBe(8)
    expect(twice.descents).toBe(16)
})
