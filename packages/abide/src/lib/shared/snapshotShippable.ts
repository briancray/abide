import { hasSeedableRequest } from './hasSeedableRequest.ts'
import type { CacheEntry } from './types/CacheEntry.ts'

/*
The one store-filter predicate selecting which cache entries are candidates for a
warm snapshot: settled AND carrying a seedable wire request (any method), so an
inline call hydrates warm on the client instead of re-firing after render. Every
selection site (serializeCacheSnapshot, the renderer's render-return and
streaming-drain filters) calls this instead of re-spelling the guard, so they
cannot drift.

Composed from `hasSeedableRequest` — the request half snapshotEntryFromCache
also gates on. snapshotEntryFromCache itself uses ONLY the request half (not
`settled`): the streaming-drain path hands it still-pending entries and awaits
them, so it can't require `settled` up front.

This is the SYNC half of shippability — what's knowable from the entry without
awaiting its body. The async response-level half (non-streaming + warmable kind)
lives in snapshotEntryFromCache, reading the resolved Response.
*/
export function snapshotShippable(entry: CacheEntry): boolean {
    return entry.settled === true && hasSeedableRequest(entry)
}
