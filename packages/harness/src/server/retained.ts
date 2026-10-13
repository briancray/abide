// WHAT AN OP LEFT REACHABLE, by JSC type, and the one thing `heapStats()` can
// actually tell you.
//
// `heapStats()` after a `fullGC()` counts what is still REACHABLE, which is not the
// same question as what was allocated. Measured: the same 2000-rep `new URL()` batch
// six times over came back 2000 every run with the results held in an outer array,
// and 2002 / 2000 / 2000 / 0 with them held in a block-scoped local — run 3 did not
// lose them to GC nondeterminism, JSC saw the local was never read after the loop and
// collected it before the `after` read. So whether a gate observes what it gates
// would depend on the optimizer's liveness analysis of a case body, invisible at the
// call site and flipping when the body is edited for an unrelated reason. This
// function answers the question that is stable; `allocated()` answers the other one
// and is tagged so it cannot be gated on.

import { countsMoved, liveCounts } from './liveCounts.ts'

// The keep-alive. What the body handed back stays reachable across the `after` read,
// so the diff is what the op RETAINS rather than what the optimizer let survive.
const ROOTS: unknown[] = []

/**
 * The change in reachable objects by JSC type across one call of `body`, with its result held.
 *
 * Throws in a process with a DOM (44.16).
 *
 * JSC BUCKETS A PLAIN CLASS INSTANCE AS `Object`. A gate written against
 * `objectTypeCounts.Scope` reads 0 forever and is green forever, and so does a gate reading a
 * FILTERED diff — the seven-type filter this started as had no `Object` in it, and `Object` is
 * exactly where `Scope` and `Call` land. So the whole diff comes back and the finding is a note
 * rather than a filter.
 */
export function retained(body: () => unknown): Record<string, number> {
    const before = liveCounts('retained')
    // ROOTED, not held in a local. A block-scoped local is what JSC's liveness
    // analysis collected before the `after` read on run 3 of 6; a write to a
    // module-level binding is an observable effect and cannot be reasoned away.
    ROOTS.push(body())
    const after = liveCounts('retained')
    ROOTS.length = 0
    return countsMoved(before, after, 1)
}
