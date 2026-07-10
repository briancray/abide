import type { PatchEvent } from './types/PatchEvent.ts'

/*
Process-global tap for every document mutation. `createDoc` emits a `PatchEvent`
here on each applied patch; cross-cutting consumers (the inspector's change feed, a
component's model-doc capture) subscribe. One chokepoint means those features read a
single uniform stream instead of each re-deriving change detection. `active` lets the
emitter skip the emit entirely when nobody is listening.
*/
const listeners = new Set<(event: PatchEvent) => void>()

export const PATCH_BUS = {
    /* True only while at least one consumer is attached; lets the emitter skip the emit. */
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
