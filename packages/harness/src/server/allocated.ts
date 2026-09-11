// WHAT AN OP ALLOCATED, which `heapStats()` cannot see and this therefore does not
// pretend to report exactly. A batch mean, tagged, and the tag is the point: an exact
// integer is `retained()`'s to hand out, and `SERVER.md`'s fractional `Object:3.09`
// is a reachability artefact rather than a genuinely fractional quantity.
//
// What a fractional per-rep count IS good for is the other question: a non-integer
// means the allocation is conditional or amortised — a rehash, an IC transition, a
// once-per-batch structure — and a mean over the whole batch hides which. So the
// batch is halved and the two halves are reported apart. Zero growth across them is
// the leak check.

import { fullGC, heapStats } from 'bun:jsc'

const DEFAULT_REPS = 1000

function counts(): Record<string, number> {
    fullGC()
    return heapStats().objectTypeCounts as Record<string, number>
}

function meanPerRep(
    before: Record<string, number>,
    after: Record<string, number>,
    reps: number,
): Record<string, number> {
    const out: Record<string, number> = {}
    for (const type of new Set([
        ...Object.keys(before),
        ...Object.keys(after),
    ])) {
        const moved = (after[type] ?? 0) - (before[type] ?? 0)
        if (moved !== 0) out[type] = moved / reps
    }
    return out
}

export function allocated(
    body: () => unknown,
    reps = DEFAULT_REPS,
): {
    // A literal, so this record can never be `toMatchObject`'d against an exact
    // integer the way a `retained()` diff is.
    tagged: 'batch mean'
    reps: number
    perRep: Record<string, number>
    // The last half's mean minus the first half's, per rep. A type that grows across
    // the batch is retaining rather than allocating.
    growth: Record<string, number>
} {
    if (typeof document !== 'undefined')
        throw new Error(
            'allocated() ran in a process with a DOM. happy-dom buckets as `Object` exactly where the framework does, so the totals would move with the emulator.',
        )
    const half = Math.max(1, Math.floor(reps / 2))
    const start = counts()
    for (let rep = 0; rep < half; rep += 1) body()
    const middle = counts()
    for (let rep = 0; rep < half; rep += 1) body()
    const end = counts()

    const first = meanPerRep(start, middle, half)
    const second = meanPerRep(middle, end, half)
    const growth: Record<string, number> = {}
    for (const type of new Set([
        ...Object.keys(first),
        ...Object.keys(second),
    ])) {
        const moved = (second[type] ?? 0) - (first[type] ?? 0)
        if (moved !== 0) growth[type] = moved
    }
    return {
        tagged: 'batch mean',
        reps: half * 2,
        perRep: meanPerRep(start, end, half * 2),
        growth,
    }
}
