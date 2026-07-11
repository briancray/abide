import type { CacheEntry } from './types/CacheEntry.ts'

/*
Whether a cache entry carries a wire request that can be SEEDED into the SSR warm
snapshot — any method, so an inline (bare smart read) call hydrates warm on the
client instead of re-firing after render, regardless of verb. A value called
inline during render is being used as a read; the seed carries the SSR-computed
body so the client reads it warm rather than issuing a second call. Producer
entries (no request) and stream cells (a `NamedAsyncIterable` cell holds no wire
request) fail it — neither can round-trip a url/method/body through the snapshot.

This gates SEEDING, not re-firing. Re-firing unprompted (invalidate-policy
refetch, snapshot replay) stays GET-only (REPLAYABLE_METHODS / isReplayableMethod
in cache.ts) so a genuine write coalesces-only and stays re-submittable — a
seeded POST is read warm once, never auto-replayed.

The request half of snapshot shippability, factored out so the two gates that
need it cannot drift: `snapshotShippable` composes it with `settled` for the
store-filter sites, and `snapshotEntryFromCache` calls it alone — its
streaming-drain caller hands it still-pending entries it then awaits, so it can't
require `settled` up front.
*/
export function hasSeedableRequest(entry: CacheEntry): boolean {
    return entry.request !== undefined
}
