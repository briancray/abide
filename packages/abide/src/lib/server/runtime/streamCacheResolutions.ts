import type { CacheEntry } from '../../shared/types/CacheEntry.ts'
import type { CacheSnapshotEntry } from '../../shared/types/CacheSnapshotEntry.ts'
import type { CacheStore } from '../../shared/types/CacheStore.ts'
import type { StreamedResolution } from '../../shared/types/StreamedResolution.ts'
import { snapshotEntryFromCache } from './snapshotEntryFromCache.ts'

/*
Drains the pending ({#await}) cache entries in resolution order — whichever
fetch lands next is yielded next, so a slow entry never blocks a fast one
behind it. Yields exactly one StreamedResolution per entry: the snapshot when
serialization succeeds, or a `{ key, miss }` marker when the body can't ship so
the client placeholder re-fetches instead of hanging on a deferred that never
settles.
*/
export async function* streamCacheResolutions(
    store: CacheStore,
    pending: CacheEntry[],
): AsyncIterable<StreamedResolution> {
    /*
    Tag each pending serialization with its key so the loop can drop exactly
    the one that just settled. Deleting inside the `.then` instead would race
    the loop — already-resolved promises empty the map before the first
    Promise.race runs — so removal happens here, after the await.
    */
    const inflight = new Map<string, Promise<{ key: string; snapshot?: CacheSnapshotEntry }>>()
    for (const entry of pending) {
        inflight.set(
            entry.key,
            snapshotEntryFromCache(store, entry).then((snapshot) => ({ key: entry.key, snapshot })),
        )
    }
    while (inflight.size > 0) {
        const { key, snapshot } = await Promise.race(inflight.values())
        inflight.delete(key)
        yield snapshot ?? { key, miss: true }
    }
}
