import { track } from './track.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'
import { updateIfNecessary } from './updateIfNecessary.ts'

/*
Reads a node's current value and subscribes the running observer to it. A computed
settles first (the lazy pull — `updateIfNecessary` refreshes only the deps that
changed, recomputing if any did); a signal has no compute and returns its stored
value directly. Tracking happens after the settle so the reader links to the
computed itself, not its transitive deps.

The settle runs in a `try` whose `finally` still links the reader: an edge to a
node is an edge even when that node is currently PAUSED. A computed whose compute
throws — the common case being a `SuspenseSignal` from a pending blocking cell it
reads — must still leave its reader subscribed to it, or the reader would never
re-run when the paused branch resolves (the compute re-runs on settle via its own
retained deps, then this reader wakes off its edge to the computed). The signal
fast-path stays a plain track — it has no compute to throw and is the hot read.
*/
export function readNode(node: ReactiveNode): unknown {
    if (node.compute !== undefined) {
        try {
            updateIfNecessary(node)
            /* Throw memoisation: a paused/erroring compute settled CLEAN with its throw
               retained (`runNode`'s catch) — rethrow it so EVERY reader observes the
               pause/error, not just the one whose read ran the compute. Cleared by the
               next successful run once a dep change re-dirties the node. */
            if (node.thrown !== undefined) {
                throw node.thrown
            }
        } finally {
            track(node)
        }
        return node.value
    }
    track(node)
    return node.value
}
