import { OWNER } from './OWNER.ts'
import { REACTIVE_CONTEXT } from './REACTIVE_CONTEXT.ts'
import { runNode } from './runNode.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Creates an effect: a side-effecting node that runs once immediately (capturing
its dependencies) and again whenever any of them change. Returns a dispose that
unlinks it from the graph and clears any pending re-run, so a torn-down effect
leaves no back-links — the open-on-first-read / close-on-last-reader lifecycle.
When created inside a `scope()` build, the disposer is also registered with the
owner so the whole component tears down together.
*/
export function createEffectNode(fn: () => void): () => void {
    const node: ReactiveNode = {
        value: undefined,
        compute: fn,
        deps: new Set(),
        observers: new Set(),
        dirty: false,
        isEffect: true,
    }
    runNode(node)
    const dispose = () => {
        for (const dep of node.deps) {
            dep.observers.delete(node)
        }
        node.deps.clear()
        REACTIVE_CONTEXT.pendingEffects.delete(node)
    }
    if (OWNER.current !== undefined) {
        OWNER.current.push(dispose)
    }
    return dispose
}
