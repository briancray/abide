import { invalidateEvent } from '../shared/invalidateEvent.ts'
import type { CacheStore } from '../shared/types/CacheStore.ts'
import type { StreamedResolution } from '../shared/types/StreamedResolution.ts'
import { cacheEntryFromSnapshot } from './cacheEntryFromSnapshot.ts'
import { refetchPlaceholder } from './refetchPlaceholder.ts'
import type { StreamingDeferred } from './types/StreamingDeferred.ts'

/*
Settles one streamed resolution against its placeholder. A snapshot overwrites
the placeholder with a warm entry (so re-renders and later reads are sync) and
fires an invalidate to re-run any read mounted before it arrived; a miss
re-fetches the request live. Either way it resolves the deferred so a {#await}
already awaiting the placeholder promise unblocks, and removes it from the
registry so a later flush only touches genuine leftovers.
*/
export function applyStreamedResolution(
    store: CacheStore,
    deferreds: Map<string, StreamingDeferred>,
    resolution: StreamedResolution,
): void {
    const deferred = deferreds.get(resolution.key)
    deferreds.delete(resolution.key)
    if ('miss' in resolution) {
        if (deferred) {
            refetchPlaceholder(deferred)
        }
        return
    }
    const entry = cacheEntryFromSnapshot(resolution)
    store.entries.set(resolution.key, entry)
    deferred?.resolve(entry.promise as Promise<Response>)
    store.events.dispatchEvent(invalidateEvent([resolution.key]))
}
