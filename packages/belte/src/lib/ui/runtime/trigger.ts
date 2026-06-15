import { flushEffects } from './flushEffects.ts'
import { REACTIVE_CONTEXT } from './REACTIVE_CONTEXT.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Propagates a change forward from a just-written node: effect observers are
queued, computed observers are marked dirty and recursed into (their value may
now differ, so their own observers must learn of it). Recompute itself is lazy —
a computed recomputes on next read — so this pass only invalidates and collects
effects. Flushes immediately unless inside a batch, where the batch owner flushes
once on exit.
*/
export function trigger(node: ReactiveNode): void {
    for (const observer of node.observers) {
        if (observer.isEffect) {
            REACTIVE_CONTEXT.pendingEffects.add(observer)
        } else if (!observer.dirty) {
            observer.dirty = true
            trigger(observer)
        }
    }
    if (REACTIVE_CONTEXT.batchDepth === 0) {
        flushEffects()
    }
}
