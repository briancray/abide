import { flushEffects } from './flushEffects.ts'
import { NODE_STATE } from './NODE_STATE.ts'
import { REACTIVE_CONTEXT } from './REACTIVE_CONTEXT.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Raises `node` to at least `status` and propagates the news up its subscriber cone.
An effect crossing out of CLEAN is queued (whether it became CHECK or DIRTY — the
flush decides whether it really runs). A computed crossing out of CLEAN propagates
CHECK to *its* subscribers, so the whole cone learns a dependency *might* have
changed; it does so exactly once (a later CHECK→DIRTY upgrade re-notifies nobody —
its subscribers are already CHECK). No compute runs here, so no subscriber list is
re-linked mid-walk (`track`/`runNode` run inside compute, which only the flush
reaches). `nextSub` is read before recursing so the walk holds no edge a deeper
pass could detach.
*/
function mark(node: ReactiveNode, status: number): void {
    if (node.status >= status) {
        return
    }
    const wasClean = node.status === NODE_STATE.CLEAN
    node.status = status
    if (node.isEffect) {
        if (wasClean) {
            REACTIVE_CONTEXT.pendingEffects.add(node)
        }
        return
    }
    /* A computed propagates CHECK to its subscribers only on its first move out of
       CLEAN — they are already CHECK on any later upgrade, so re-walking is wasted. */
    if (!wasClean) {
        return
    }
    let link = node.subsHead
    while (link !== undefined) {
        const next = link.nextSub
        mark(link.sub, NODE_STATE.CHECK)
        link = next
    }
}

/*
Propagates a change forward from a just-written signal: its direct subscribers read
a value that actually changed, so they are DIRTY; the rest of their cone is CHECK
(a transitive dependency *may* have changed — `updateIfNecessary` will verify on
read). Recompute is lazy. The queued effects flush once, at the outermost trigger
(or, inside a batch, when the batch owner flushes) — never mid-propagation, so an
effect never runs against a half-marked graph.
*/
export function trigger(node: ReactiveNode): void {
    let link = node.subsHead
    while (link !== undefined) {
        const next = link.nextSub
        mark(link.sub, NODE_STATE.DIRTY)
        link = next
    }
    if (REACTIVE_CONTEXT.batchDepth === 0) {
        flushEffects()
    }
}
