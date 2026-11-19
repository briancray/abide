// WHAT EACH RUN OF AN OP KEEPS, as a batch mean: the objects still reachable after a full
// collection, per run. NOT WHAT IT ALLOCATED — `heapStats()` counts survivors only, and JSC has no
// allocation counter, so an op that builds four objects and drops them reads ~0 here, and this was
// named `allocated` while it read that. Tagged, and the tag is the point: an exact integer is
// `retained()`'s to hand out, and a fractional reading like `Object:3.09` is a reachability
// artifact rather than a genuinely fractional quantity.
//
// What a fractional per-run count IS good for is the other question: a non-integer means what is
// kept is conditional or amortized — a rehash, a cache filling, a once-per-batch structure — and a
// mean over the whole batch hides which. So the batch is halved and the two halves are reported
// apart. Zero growth across them is the leak check.

import { countsMoved, liveCounts } from './liveCounts.ts'

const DEFAULT_REPS = 1000

/**
 * Mean objects each rep leaves reachable, by JSC type over a batch, and how that mean grew between
 * its halves.
 *
 * A batch mean, never exact — gate exact counts on `retained()`. Throws in a process with a DOM.
 */
export function retainedPerRun(
    body: () => unknown,
    reps = DEFAULT_REPS,
): {
    /**
     * Always `'batch mean'`.
     *
     * A literal, so this record can never be `toMatchObject`'d against an exact integer the way a
     * `retained()` diff is.
     */
    tagged: 'batch mean'
    reps: number
    perRep: Record<string, number>
    /**
     * The last half's mean minus the first half's, per rep.
     *
     * A type that grows across the batch is retaining rather than allocating.
     */
    growth: Record<string, number>
} {
    const half = Math.max(1, Math.floor(reps / 2))
    const start = liveCounts('retainedPerRun')
    for (let rep = 0; rep < half; rep += 1) body()
    const middle = liveCounts('retainedPerRun')
    for (let rep = 0; rep < half; rep += 1) body()
    const end = liveCounts('retainedPerRun')

    const first = countsMoved(start, middle, half)
    const second = countsMoved(middle, end, half)
    return {
        tagged: 'batch mean',
        reps: half * 2,
        perRep: countsMoved(start, end, half * 2),
        growth: countsMoved(first, second, 1),
    }
}
