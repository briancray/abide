import { flushEffects } from './flushEffects.ts'
import { REACTIVE_CONTEXT } from './REACTIVE_CONTEXT.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Invalidates the observer cone of a just-written node: effect observers are
queued, computed observers are marked dirty and recursed into (their value may
now differ, so their own observers must learn of it). Recompute is lazy — a
computed recomputes on next read — so this pass only invalidates and collects.

The subscriber list is walked live: invalidate runs no compute and no effect, so
nothing re-subscribes (the only mutators of a subscriber list, `track` and
`runNode`, run inside compute execution, which only `flushEffects` reaches — after
this pass). The re-subscribe hazard belongs to the flush, where `flushEffects`
defends with its own snapshot. `nextSub` is read before recursing, so the walk
holds no reference a downstream pass could invalidate.
*/
function invalidate(node: ReactiveNode): void {
    let link = node.subsHead
    while (link !== undefined) {
        const observer = link.sub
        const next = link.nextSub
        if (observer.isEffect) {
            REACTIVE_CONTEXT.pendingEffects.add(observer)
        } else if (!observer.dirty) {
            observer.dirty = true
            invalidate(observer)
        }
        link = next
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
