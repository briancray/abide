// Live objects by JSC type, and the change between two readings — what `retained()` and
// `allocated()` both diff. Not on the lane's entry: each of the two says what its reading means.

import { fullGC, heapStats } from 'bun:jsc'

/**
 * Live object counts by JSC type, after a full collection.
 *
 * Throws in a process with a DOM, naming the `caller` that read it — `retained`'s under 44.16.
 */
export function liveCounts(caller: string): Record<string, number> {
    // happy-dom's own implementation objects land in the same untyped `Object` bucket as the
    // framework's, so a total taken in a preloaded process is worthless for any op that touches
    // the DOM. `bunfig.toml` preloads a DOM into every `bun test` process, so the allocation gates
    // get their own preload-free invocation and this converts the silent contamination into a
    // failure.
    if (typeof document !== 'undefined')
        throw new Error(
            `${caller}() ran in a process with a DOM. happy-dom buckets as \`Object\` exactly where the framework does, so the totals would move with the emulator. Run the allocation gates in a preload-free process.`,
        )
    fullGC()
    return heapStats().objectTypeCounts as Record<string, number>
}

/** What moved from `before` to `after`, per type and divided by `per`, with every unmoved type left out. */
export function countsMoved(
    before: Record<string, number>,
    after: Record<string, number>,
    per: number,
): Record<string, number> {
    const moved: Record<string, number> = {}
    for (const type of new Set([
        ...Object.keys(before),
        ...Object.keys(after),
    ])) {
        const change = (after[type] ?? 0) - (before[type] ?? 0)
        if (change !== 0) moved[type] = change / per
    }
    return moved
}
