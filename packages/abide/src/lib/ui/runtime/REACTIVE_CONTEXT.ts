import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Mutable singletons shared by every reactive primitive: the observer currently
running (so a read can register itself as that observer's dependency), the queue
of effects dirtied since the last flush, and the batch depth (writes inside a
batch queue effects and flush once on exit). Held on one object so signal,
computed, and effect all reference the same graph state without a barrel.

`pendingEffects` is a plain array, not a `Set`: an effect is enqueued only on its
CLEAN→dirty transition (`mark`'s `wasClean` gate), so it can be pushed at most once
per flush cycle — the status machine already guarantees the dedup a `Set` would,
without hashing every enqueue. The flush double-buffers (swaps in a fresh array) so
effects re-dirtied mid-flush queue for the next pass.
*/
export const REACTIVE_CONTEXT: {
    observer: ReactiveNode | undefined
    pendingEffects: ReactiveNode[]
    batchDepth: number
} = { observer: undefined, pendingEffects: [], batchDepth: 0 }
