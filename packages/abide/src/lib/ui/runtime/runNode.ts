import { abortNode } from './abortNode.ts'
import { endTracking } from './endTracking.ts'
import { NODE_STATE } from './NODE_STATE.ts'
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
        const next = node.compute?.()
        /* Value memoisation: only a computed whose result actually changed marks its
           subscribers DIRTY, so the in-progress check walk recomputes them. An
           Object.is-equal recompute leaves them at CHECK — they settle back to CLEAN
           on read without re-running, never waking downstream. An effect has no value
           worth comparing and no subscribers, so this is a no-op for it (its body ran
           inside compute above). The subscriber list isn't re-linked here — only its
           members' `status` is bumped — so walking it live is safe.

           This bumps status directly, bypassing `mark` — it neither enqueues effects nor
           propagates CHECK onward, yet nothing is missed: this recompute only happens
           while settling a subscriber that was itself reached from the originating
           write's `mark` propagation, which already CHECK-marked (and so enqueued) every
           effect in this cone on their CLEAN→CHECK edge. So every subscriber here is
           already CHECK/queued; the direct write only UPGRADES it CHECK→DIRTY so its own
           settle recomputes instead of memoising back to CLEAN. */
        if (!Object.is(node.value, next)) {
            node.value = next
            let link = node.subsHead
            while (link !== undefined) {
                link.sub.status = NODE_STATE.DIRTY
                link = link.nextSub
            }
        }
        node.status = NODE_STATE.CLEAN
        node.thrown = undefined
        return node.value
    } catch (error) {
        /* The compute threw — commonly a `SuspenseSignal` from a pending blocking cell it read,
           propagating the pause down this edge. Settle the node CLEAN anyway (its value is left
           stale) so a later change to the deps it DID track before throwing re-marks it DIRTY and
           re-propagates to its subscribers; left DIRTY, `mark`'s status gate would take the
           settle's CLEAN→DIRTY edge as already-dirty and leave the node permanently inert — the
           same reset `flushEffects` applies to a thrown effect. The throw is also RETAINED on the
           node: a CLEAN settle memoises, so without it only this first reader would observe the
           pause/error and every later reader would silently get the stale value — `readNode`
           rethrows the retained throw until the next successful run clears it. */
        node.status = NODE_STATE.CLEAN
        node.thrown = error
        throw error
    } finally {
        REACTIVE_CONTEXT.observer = previous
        /* Drop the edges `track` didn't reuse — last run's now-stale dependencies. */
        endTracking(node)
    }
}
