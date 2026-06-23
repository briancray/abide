import { NODE_STATE } from './NODE_STATE.ts'
import { runNode } from './runNode.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Settles a node so its value is current before it is read (or, for an effect, before
it runs at flush). CLEAN: nothing to do. CHECK: a transitive dependency *might* have
changed — refresh each direct dependency in turn; refreshing one that truly changed
marks this node DIRTY (`runNode` does the marking), so stop the moment that happens.
DIRTY (set directly by a write, or by the check walk): recompute.

A CHECK node whose dependencies all recompute to equal values ends CLEAN without
recomputing — the value memoisation that stops an unchanged computed from waking its
readers. Refreshing deps top-down *before* a recompute reads them is what keeps the
pull glitch-free: a reader never observes a stale intermediate, because by the time
it recomputes, every dependency it reads has already settled this pass.
*/
export function updateIfNecessary(node: ReactiveNode): void {
    if (node.status === NODE_STATE.CLEAN) {
        return
    }
    if (node.status === NODE_STATE.CHECK) {
        let link = node.depsHead
        while (link !== undefined) {
            updateIfNecessary(link.dep)
            /* A dep recomputed to a changed value and marked us DIRTY — no need to
               check the rest, we already know we must recompute. */
            if (node.status === NODE_STATE.DIRTY) {
                break
            }
            link = link.nextDep
        }
    }
    if (node.status === NODE_STATE.DIRTY) {
        runNode(node)
    } else {
        /* CHECK with no changed dependency — the cached value still holds. */
        node.status = NODE_STATE.CLEAN
    }
}
