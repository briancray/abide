import { abortNode } from './abortNode.ts'
import { endTracking } from './endTracking.ts'
import { REACTIVE_CONTEXT } from './REACTIVE_CONTEXT.ts'
import { reactiveAbortState } from './reactiveAbortState.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Runs a compute node (computed or effect) with dependency capture. Rewinds the
recompute cursor (`depsTail`) to the start of the dependency list, installs itself
as the current observer so reads inside `compute` re-link via `track`, runs, then
trims every edge `track` didn't reuse — last run's dependencies that weren't read
this time. Re-capturing every run is what makes dependencies dynamic: a branch not
taken this run leaves its edges past the cursor, so they are dropped here. Returns
the fresh value (used by lazy computed reads).
*/
export function runNode(node: ReactiveNode): unknown {
    /* This run supersedes the prior one — abort any RPC it left in flight before
       re-tracking, so a stale request never lands after a newer one started. The
       `armed` gate inlines here so an app that never fires a reactive RPC pays one
       property read on this hot path, not a call. */
    if (reactiveAbortState.armed) {
        abortNode(node)
    }
    /* Rewind: track() walks forward from here, reusing matching edges in order. */
    node.depsTail = undefined
    const previous = REACTIVE_CONTEXT.observer
    REACTIVE_CONTEXT.observer = node
    try {
        node.value = node.compute?.()
        node.dirty = false
        return node.value
    } finally {
        REACTIVE_CONTEXT.observer = previous
        /* Drop the edges `track` didn't reuse — last run's now-stale dependencies. */
        endTracking(node)
    }
}
