import { REACTIVE_CONTEXT } from './REACTIVE_CONTEXT.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Links a node being read to the observer currently running, in both directions,
so a later write to the node reaches the observer and a recompute can unlink it.
A no-op outside any tracking scope — reads in plain code (and on the server)
register nothing, so the same callable works tracked and untracked.
*/
export function track(node: ReactiveNode): void {
    const observer = REACTIVE_CONTEXT.observer
    if (observer === undefined) {
        return
    }
    node.observers.add(observer)
    observer.deps.add(node)
}
