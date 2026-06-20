import { isReplayableMethod } from '../../shared/isReplayableMethod.ts'
import type { CacheSnapshotEntry } from '../../shared/types/CacheSnapshotEntry.ts'
import type { CacheStore } from '../../shared/types/CacheStore.ts'
import { snapshotEntryFromCache } from './snapshotEntryFromCache.ts'

/*
Snapshots the request-scoped cache for SSR at a single instant: every replayable
(GET/DELETE) entry settled by now, serialized to a wire-safe CacheSnapshotEntry the
client seeds its store from. Unsettled and non-replayable entries are skipped; a body
that can't ship (binary / streaming / rejected) drops out via snapshotEntryFromCache.

Snapshots concurrently — the awaits are immediate (entries are already settled), but
their body reads run in parallel. Never blocks on an unsettled entry.

WHEN it's called decides what it sees. createUiPageRenderer calls it at render-return
for `__SSR__` — that catches only top-level `await` reads (render blocked on them). A
`{#await cache()}` read does NOT appear: its expression is a thunk renderToStream runs
lazily, so its entry is created mid-stream, after this snapshot. The renderer snapshots
AGAIN once the stream has drained (entries then exist and are settled) and seeds those
over the wire — see its post-stream `__abideResolve` pass. So for a streaming page the
render-return snapshot is typically empty; the warm cache arrives over the stream.
*/
export async function serializeCacheSnapshot(store: CacheStore): Promise<CacheSnapshotEntry[]> {
    const settled = Array.from(store.entries.values()).filter(
        (entry) =>
            entry.settled === true &&
            entry.request !== undefined &&
            isReplayableMethod(entry.request.method.toUpperCase()),
    )
    const snapshots = await Promise.all(
        settled.map((entry) => snapshotEntryFromCache(store, entry)),
    )
    return snapshots.filter((snapshot): snapshot is CacheSnapshotEntry => snapshot !== undefined)
}
