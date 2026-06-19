import type { PatchEvent } from './types/PatchEvent.ts'

/*
Process-global tap for every document mutation. `createDoc` emits a `PatchEvent`
here on each applied patch; cross-cutting consumers (undo history, persistence,
sync) subscribe. One chokepoint means those features journal a single uniform
stream instead of each re-deriving change detection. `active` lets the emitter
skip computing an inverse — its only real cost — when nobody is listening.
*/
const listeners = new Set<(event: PatchEvent) => void>()

export const PATCH_BUS = {
    /* True only while at least one consumer is attached; gates inverse capture. */
    get active(): boolean {
        return listeners.size > 0
    },
    emit(event: PatchEvent): void {
        for (const listener of listeners) {
            listener(event)
        }
    },
    subscribe(listener: (event: PatchEvent) => void): () => void {
        listeners.add(listener)
        return () => {
            listeners.delete(listener)
        }
    },
}
