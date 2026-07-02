import { CURRENT_SCOPE } from './CURRENT_SCOPE.ts'
import { inScope } from './inScope.ts'
import { NODE_STATE } from './NODE_STATE.ts'
import { OWNER } from './OWNER.ts'
import { runNode } from './runNode.ts'
import { toTeardown } from './toTeardown.ts'
import type { EffectResult } from './types/EffectResult.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'
import type { Teardown } from './types/Teardown.ts'
import { unlinkDeps } from './unlinkDeps.ts'

/*
Creates an effect: a side-effecting node that runs once immediately (capturing
its dependencies) and again whenever any of them change. The body may return a
teardown — run before each re-run and on dispose — and may be async (its teardown
then runs once the promise settles, never awaited). Returns a dispose that runs
the final teardown and unlinks the node from the graph, so a torn-down effect
leaves no back-links and no live resource — the open-on-first-read /
close-on-last-reader lifecycle. When created inside a `scope()` build, the
disposer is also registered with the owner so the whole component tears down
together.
*/
export function createEffectNode(fn: () => EffectResult): () => void {
    /* The body's teardown, replaced each run. Held in this closure rather than on
       ReactiveNode so signals and computeds — which share the node shape and the
       read/write hot path — pay nothing for a feature only effects use. */
    let cleanup: Teardown | undefined
    /* The teardown fires deferred (before a re-run, on dispose) when the ambient scope
       has moved on; pin the one current at creation so an ambient `scope()` inside it
       resolves the owning component, matching how `attach` pins its teardown. */
    const captured = CURRENT_SCOPE.current
    /* Runs the previous run's teardown before re-running and on dispose, exactly
       once each. */
    const runCleanup = (): void => {
        if (cleanup !== undefined) {
            const teardown = cleanup
            cleanup = undefined
            inScope(captured, teardown)
        }
    }
    const node: ReactiveNode = {
        value: undefined,
        compute: () => {
            runCleanup()
            cleanup = toTeardown(fn())
        },
        depsHead: undefined,
        depsTail: undefined,
        subsHead: undefined,
        subsTail: undefined,
        /* Born DIRTY; the immediate `runNode` below captures deps and settles it CLEAN. */
        status: NODE_STATE.DIRTY,
        isEffect: true,
    }
    runNode(node)
    const dispose = () => {
        runCleanup()
        unlinkDeps(node)
        /* Clearing compute makes runNode a no-op: an effect disposed mid-flush (by an
           earlier effect in the same batch) is still in the queue flushEffects is
           draining, so without this it would re-run its body and re-link into the graph
           — a disposed effect resurrected. This alone neutralizes it; the queue is a
           plain array (no O(1) delete) and a settled no-op iteration is cheaper than an
           O(n) splice, so the stale entry is left to be skipped on its flush. */
        node.compute = undefined
    }
    if (OWNER.current !== undefined) {
        OWNER.current.push(dispose)
    }
    return dispose
}
