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
byte-matches the SSR DOM. Live fetches leave it undefined and take the async
decode path.

`hydrated` marks an entry built from the SSR snapshot, which ships no wrap
options — the first read consumes the flag and adopts its call site's `ttl`
(omitted = forever, as shipped; ttl > 0 = expiry clock starts at that read;
ttl = 0 = the warm value exists only to complete the hydration render and is
evicted a macrotask later). Live entries never carry it; their ttl was fixed
at registration.

`tags` holds the cache() call's tags as a Set so
`cache.invalidate({ tags })` can drop every entry sharing any tag with O(1)
membership; a re-read merges new tags in rather than replacing them.

`settled` flips true once the stored promise resolves. SSR snapshot
serialization reads it after `render()` returns to partition entries: ones
settled by then were consumed via `await` (render blocked on them) and inline
into `__SSR__`; ones still pending were consumed via `{#await}` (render emitted
the pending branch without blocking) and stream a resolve chunk instead.

`refreshing` flips true while this entry is reloading data it already held —
either an `swr` refetch (stale value still visible) or the default
drop-then-reload (the prior entry was invalidated and dropped, this is its
replacement read). It backs refreshing(), distinguishing a reload from a
first-ever load; cleared when the read settles.

`invalidation` holds the entry's `swr` policy: the refetch thunk (the call
captured with its args) plus its optional throttle/debounce window and runtime
timer state, so invalidate() keeps the stale value and revalidates this key —
rate-limited by the window — instead of dropping the entry. Set at registration
when the creating read declared `swr`, or attached by a later read declaring it
on an entry that lacks it (hydrated snapshot entries always start without one) —
first wins. An armed `timer` is cleared if the entry is evicted, so a dead key
never refetches. Wrap-time validation guarantees `swr` never coexists with
ttl: 0 and never sits on a non-replayable remote method.
*/
export type CacheEntry = {
    key: string
    promise: Promise<unknown>
    request?: Request
    ttl: number | undefined
    expiresAt: number | undefined
    value?: unknown
    tags?: Set<string>
    settled?: boolean
    hydrated?: boolean
    refreshing?: boolean
    invalidation?: InvalidationState
    /*
    Set by the smart bare call (a replayable read routed through cache.read): the
    display value is retained unconditionally and `ttl` marks a staleness deadline
    (the next read past it revalidates in the background, stale stays visible) rather
    than driving the hard eviction an explicit cache() ttl triggers. Distinguishes the
    smart-read lifecycle from the explicit cache()/invalidate old surface, which keeps
    its drop-on-ttl / drop-on-invalidate behaviour.
    */
    retain?: boolean
}

/* Per-key invalidate coalescing: the throttle/debounce policy plus the timer/in-flight state. */
type InvalidationState = {
    refetch: () => Promise<unknown>
    throttle?: number
    debounce?: number
    lastFiredAt?: number
    timer?: ReturnType<typeof setTimeout>
    /*
    An invalidation that arrived while a refetch was already in flight: fireRefetch
    can't run concurrently, so it sets this flag and re-schedules once the
    in-flight refetch settles, rather than dropping the newer invalidation.
    */
    pending?: boolean
}
