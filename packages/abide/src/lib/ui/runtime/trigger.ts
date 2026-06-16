import { flushEffects } from './flushEffects.ts'
import { REACTIVE_CONTEXT } from './REACTIVE_CONTEXT.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Invalidates the observer cone of a just-written node: effect observers are
queued, computed observers are marked dirty and recursed into (their value may
now differ, so their own observers must learn of it). Recompute is lazy — a
computed recomputes on next read — so this pass only invalidates and collects.

Each observer set is snapshotted before iteration: flushing a queued effect can
synchronously recompute a downstream computed, and `runNode` re-subscribes it by
deleting then re-adding itself to the very sets being walked here — mutating a
live `for…of` over a Set re-yields the re-added entry forever.
*/
function invalidate(node: ReactiveNode): void {
    for (const observer of [...node.observers]) {
        if (observer.isEffect) {
            REACTIVE_CONTEXT.pendingEffects.add(observer)
        } else if (!observer.dirty) {
            observer.dirty = true
            invalidate(observer)
        }
    }
}

/*
Propagates a change forward from a just-written node. Invalidation collects the
whole cone first; the queued effects flush once, at the outermost trigger (or,
inside a batch, when the batch owner exits) — never mid-propagation, so an effect
never runs against a half-invalidated graph.
*/
export function trigger(node: ReactiveNode): void {
    invalidate(node)
    if (REACTIVE_CONTEXT.batchDepth === 0) {
        flushEffects()
    }
}
