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

`value` is the decoded warm value served synchronously by the read path
(cloned per read). It is set at hydration — the SSR snapshot body is
pre-decoded so the first client render reads it without a microtask hop and
byte-matches the SSR DOM — and also by cache.on's `context.patch`, which folds
an authoritative frame delta straight onto it without a refetch (ADR-0007).
Live fetches leave it undefined and take the async decode path until a patch
populates it.

`hydrated` marks an entry built from the SSR snapshot, which ships no wrap
options — the first read consumes the flag and adopts its call site's `ttl`
(omitted = forever, as shipped; ttl > 0 = expiry clock starts at that read;
ttl = 0 = the warm value exists only to complete the hydration render and is
evicted a macrotask later). Live entries never carry it; their ttl was fixed
at registration.

`scope` holds the cache() call's scope tags as a Set so
`cache.invalidate({ scope })` can drop every entry sharing any tag with O(1)
membership; a re-read merges new tags in rather than replacing them.

`settled` flips true once the stored promise resolves. SSR snapshot
serialization reads it after `render()` returns to partition entries: ones
settled by then were consumed via `await` (render blocked on them) and inline
into `__SSR__`; ones still pending were consumed via `{#await}` (render emitted
the pending branch without blocking) and stream a resolve chunk instead.

`refreshing` flips true while this entry is reloading data it already held —
either a policy stale-while-revalidate refetch (value still visible) or the
default drop-then-reload (the prior entry was invalidated and dropped, this is
its replacement read). It backs refreshing(), distinguishing a reload from a
first-ever load; cleared when the read settles.

`invalidation` holds an `invalidate` throttle/debounce policy: the refetch
thunk (the call captured with its args) plus the policy and its runtime timer
state, so invalidate() can rate-limit refetches of this key instead of dropping
the entry and refetching on every invalidation. Set at registration when the
creating read declared a policy, or attached by a later read declaring one on
an entry that lacks it (hydrated snapshot entries always start without one) —
first policy wins. An armed `timer` is cleared if the entry is evicted, so a
dead key never refetches. Wrap-time validation guarantees a policy never
coexists with ttl: 0 and never sits on a non-replayable remote method.
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
    hydrated?: boolean
    refreshing?: boolean
    invalidation?: InvalidationState
}

/* Per-key invalidate coalescing: the throttle/debounce policy plus the timer/in-flight state. */
type InvalidationState = {
    refetch: () => Promise<unknown>
    throttle?: number
    debounce?: number
    lastFiredAt?: number
    timer?: ReturnType<typeof setTimeout>
}
