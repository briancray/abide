/*
Stored shape per cache key. The stored promise resolves to the raw Response for
a remote function (the snapshot reads its status/headers/body and the cache
layer hands callers a decoded view derived from it) or to the producer's value
for a plain producer — hence `Promise<unknown>`.

`request` is retained for remote entries so SSR snapshot serialization can
record the URL and method without re-deriving them from the function. Producer
entries have no wire request, so it is absent — and the snapshot readers skip
any entry lacking it (a producer value has no rpc identity to rehydrate against).

`ttl`/`expiresAt` drive eviction: expiresAt = undefined means "no TTL" (lives
forever); ttl = 0 means "dedupe only" (entry is pruned as soon as the promise
settles).

`value` is set only for entries hydrated from the SSR snapshot: the
snapshot body is pre-decoded synchronously so the first client render can
read it without a microtask hop and byte-match the SSR DOM. Live fetches
leave it undefined and take the async decode path.

`scope` holds the cache() call's scope tags as a Set so
`cache.invalidate({ scope })` can drop every entry sharing any tag with O(1)
membership; a re-read merges new tags in rather than replacing them.

`settled` flips true once the stored promise resolves. SSR snapshot
serialization reads it after `render()` returns to partition entries: ones
settled by then were consumed via `await` (render blocked on them) and inline
into `__SSR__`; ones still pending were consumed via `{#await}` (render emitted
the pending branch without blocking) and stream a resolve chunk instead.

`invalidation` is present only when the cache() call set an `invalidate`
throttle/debounce policy: it holds the refetch thunk (the original call captured
with its args) plus the policy and its runtime timer state, so invalidate() can
rate-limit refetches of this key instead of dropping the entry and refetching on
every invalidation.
*/
export type CacheEntry = {
    key: string
    promise: Promise<unknown>
    request?: Request
    ttl: number | undefined
    expiresAt: number | undefined
    value?: unknown
    scope?: Set<string>
    settled?: boolean
    invalidation?: InvalidationState
}

/* Per-key invalidate coalescing: the throttle/debounce policy plus the timer/in-flight state. */
export type InvalidationState = {
    refetch: () => Promise<unknown>
    throttle?: number
    debounce?: number
    refreshing?: boolean
    lastFiredAt?: number
    timer?: ReturnType<typeof setTimeout>
}
