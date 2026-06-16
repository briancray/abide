import { isReplayableMethod } from '../../shared/isReplayableMethod.ts'
import type { CacheEntry } from '../../shared/types/CacheEntry.ts'
import type { CacheSnapshot } from '../../shared/types/CacheSnapshot.ts'
import type { CacheSnapshotEntry } from '../../shared/types/CacheSnapshotEntry.ts'
import type { CacheStore } from '../../shared/types/CacheStore.ts'
import { snapshotEntryFromCache } from './snapshotEntryFromCache.ts'

/*
Partitions the request-scoped cache for SSR. Entries settled by the time
`render()` returns were consumed via `await` (render blocked on them) and ship
inline in the document's `__SSR__` blob. Entries still pending were consumed
via `{#await}` — render emitted their pending branch without blocking — so they
go to `pending` for the response streamer to drain and resolve over the wire.

Unlike the old buffer-everything path, this never awaits the pending promises:
that's the whole point of streaming. Settled entries are read concurrently (the
awaits are immediate since they're already resolved, but their body reads run in
parallel); pending entries are handed back as-is for the streamer to await one
chunk at a time.
*/
export async function serializeCacheSnapshot(store: CacheStore): Promise<CacheSnapshot> {
    const settled: CacheEntry[] = []
    const pending: CacheEntry[] = []
    for (const entry of store.entries.values()) {
        /* Producer entries carry no wire request — nothing to rehydrate against, skip. */
        if (!entry.request) {
            continue
        }
        if (!isReplayableMethod(entry.request.method.toUpperCase())) {
            continue
        }
        if (entry.settled) {
            settled.push(entry)
        } else {
            pending.push(entry)
        }
    }
    const snapshots = await Promise.all(
        settled.map((entry) => snapshotEntryFromCache(store, entry)),
    )
    const inline = snapshots.filter(
        (snapshot): snapshot is CacheSnapshotEntry => snapshot !== undefined,
    )
    return { inline, pending }
}
