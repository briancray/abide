import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Mutable singletons shared by every reactive primitive: the observer currently
running (so a read can register itself as that observer's dependency), the set
of effects dirtied since the last flush, and the batch depth (writes inside a
batch queue effects and flush once on exit). Held on one object so signal,
computed, and effect all reference the same graph state without a barrel.
*/
export const REACTIVE_CONTEXT: {
    observer: ReactiveNode | undefined
    pendingEffects: Set<ReactiveNode>
    batchDepth: number
} = { observer: undefined, pendingEffects: new Set(), batchDepth: 0 }
