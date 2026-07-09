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
    deadlineMs?: number,
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
    /*
    Fail-closed deadline (ADR-0024): an auto-streamed BARE read triggered at render is
    handed here still-pending, and its fetch may never settle. When the per-render deadline
    elapses, ship every still-inflight key as a `{ key, miss }` marker so the client refetches
    on hydrate — the always-buffered Tier-1 fallback — rather than holding the response stream
    open unbounded. The {#await} drain passes settled entries that resolve well inside any
    deadline, so it never fires there; `undefined` disables the deadline entirely (the
    pre-ADR-0024 behavior). `unref` keeps the timer from holding the process open on its own.
    */
    const deadline =
        deadlineMs === undefined
            ? undefined
            : new Promise<'deadline'>((resolve) => {
                  setTimeout(() => resolve('deadline'), deadlineMs).unref?.()
              })
    while (inflight.size > 0) {
        const settled =
            deadline === undefined
                ? await Promise.race(inflight.values())
                : await Promise.race([...inflight.values(), deadline])
        if (settled === 'deadline') {
            for (const key of inflight.keys()) {
                yield { key, miss: true }
            }
            return
        }
        inflight.delete(settled.key)
        yield settled.snapshot ?? { key: settled.key, miss: true }
    }
}
