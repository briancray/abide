import { REACTIVE_CONTEXT } from './REACTIVE_CONTEXT.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Runs a compute node (computed or effect) with dependency capture: drops the
links from its previous run, installs itself as the current observer so reads
inside `compute` re-link, runs, then restores the prior observer. Re-tracking
every run is what makes dependencies dynamic — a branch not taken this run is
not subscribed. Returns the fresh value (used by lazy computed reads).
*/
export function runNode(node: ReactiveNode): unknown {
    for (const dep of node.deps) {
        dep.observers.delete(node)
    }
    node.deps.clear()
    const previous = REACTIVE_CONTEXT.observer
    REACTIVE_CONTEXT.observer = node
    try {
        node.value = node.compute?.()
        node.dirty = false
        return node.value
    } finally {
        REACTIVE_CONTEXT.observer = previous
    }
}
