// WHAT AN OP ALLOCATED, which `heapStats()` cannot see and this therefore does not
// pretend to report exactly. A batch mean, tagged, and the tag is the point: an exact
// integer is `retained()`'s to hand out, and a fractional reading like `Object:3.09`
// is a reachability artifact rather than a genuinely fractional quantity.
//
// What a fractional per-rep count IS good for is the other question: a non-integer
// means the allocation is conditional or amortized — a rehash, an IC transition, a
// once-per-batch structure — and a mean over the whole batch hides which. So the
// batch is halved and the two halves are reported apart. Zero growth across them is
// the leak check.

import { countsMoved, liveCounts } from './liveCounts.ts'

const DEFAULT_REPS = 1000

/**
 * Mean objects per rep by JSC type over a batch, and how that mean grew between its halves.
 *
 * A batch mean, never exact — gate exact counts on `retained()`. Throws in a process with a DOM.
 */
export function allocated(
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
    const start = liveCounts('allocated')
    for (let rep = 0; rep < half; rep += 1) body()
    const middle = liveCounts('allocated')
    for (let rep = 0; rep < half; rep += 1) body()
    const end = liveCounts('allocated')

    const first = countsMoved(start, middle, half)
    const second = countsMoved(middle, end, half)
    return {
        tagged: 'batch mean',
        reps: half * 2,
        perRep: countsMoved(start, end, half * 2),
        growth: countsMoved(first, second, 1),
    }
}
