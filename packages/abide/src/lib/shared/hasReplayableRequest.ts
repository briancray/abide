import { isReplayableMethod } from './isReplayableMethod.ts'
import type { CacheEntry } from './types/CacheEntry.ts'

/*
Whether a cache entry carries a wire request that can be replayed from a warm
snapshot — a replayable (GET-only) method, so the seed never re-fires a write or
loses a body. Producer entries (no request) and write methods fail it.

The request half of snapshot shippability, factored out so the two gates that
need it cannot drift: `snapshotShippable` composes it with `settled` for the
store-filter sites, and `snapshotEntryFromCache` calls it alone — its
streaming-drain caller hands it still-pending entries it then awaits, so it can't
require `settled` up front.
*/
export function hasReplayableRequest(entry: CacheEntry): boolean {
    return entry.request !== undefined && isReplayableMethod(entry.request.method.toUpperCase())
}
