import { OWNER } from './OWNER.ts'
import { REACTIVE_CONTEXT } from './REACTIVE_CONTEXT.ts'
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
    /* Runs the previous run's teardown before re-running and on dispose, exactly
       once each. */
    const runCleanup = (): void => {
        if (cleanup !== undefined) {
            const teardown = cleanup
            cleanup = undefined
            teardown()
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
        dirty: false,
        isEffect: true,
    }
    runNode(node)
    const dispose = () => {
        runCleanup()
        unlinkDeps(node)
        /* Clearing compute makes runNode a no-op: an effect disposed mid-flush (by an
           earlier effect in the same batch) is still in flushEffects' snapshot array
           after pendingEffects.delete, so it would otherwise re-run its body and
           re-link into the graph — a disposed effect resurrected. */
        node.compute = undefined
        REACTIVE_CONTEXT.pendingEffects.delete(node)
    }
    if (OWNER.current !== undefined) {
        OWNER.current.push(dispose)
    }
    return dispose
}
