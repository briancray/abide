/*
Options for cache(). The key is always auto-derived (method+url+args for a remote
function, producer-reference+args for a plain producer): hoist a producer to a
stable reference to share its entry across calls. `ttl` is the
milliseconds-past-resolve that the entry stays live: 0 = dedupe only (entry
dropped once the promise settles — the mutation idiom: in-flight coalescing and
pending() visibility, nothing retained), any other number = TTL. Omitted = forever
for a producer and for a remote call on the client; a remote call on the SERVER
with neither `ttl` nor `swr` stated defaults to 0 (coalesce-only — the request is
the atomic unit, nothing is retained past it; pair with `shared` + an explicit
`ttl` to memoise across requests).
`tags` is an array of free-form labels grouping unrelated calls so one
`cache.invalidate({ tags })` drops every entry sharing any of them — list
multiple when a call belongs to multiple invalidation groups. A unique tag (e.g.
a uuid) shared by a set of calls gives them their own private invalidation group.

`shared` opts the entry into the process-level store instead of the default
request-scoped one (server) — a store that outlives every request. It selects
the store only; it does NOT retain (pair it with `ttl` to memoise across
requests). The shared store is keyed by method+url+args, never by user, so do
not put per-user data in it — it would be served to other users. Omit `shared`
for per-request data. Write only `shared: true`; there is no `false` form. On
the client there is a single tab store, so the flag is a no-op there.

`swr` is stale-while-revalidate: it changes what a `cache.invalidate` hit does
to this key. Without it, an invalidate drops the entry and the next read shows
`pending()`. With it, the entry is kept and refetched in the background — the
existing (stale) value stays visible and `refreshing()` reports the in-flight
reload — so the reader never blanks. It governs only the refetch-after-invalidate;
the first fetch and arg-change fetches stay immediate regardless.

`swr: true` refetches immediately on every invalidate. An optional window
coalesces a burst (e.g. a socket spraying `cache.invalidate`) into far fewer
calls: `swr: { throttle: N }` refetches on the leading edge then at most once
per N ms while invalidations keep arriving; `swr: { debounce: N }` refetches
only after N ms of quiet. `swr` declares the call safe to re-run unprompted:
cache() throws at wrap time on throttle+debounce set at once, on ttl: 0 (nothing
retained, nothing to revalidate), and on a non-replayable remote method
(replaying a write is a state change disguised as a refresh). Producers are
uncheckable — set `swr` only on a producer that is a pure read.

`throttle`/`debounce` are root rate-limit windows for the refetch clock. For the
smart bare call — where SWR is unconditional for replayable reads, so there is no
`swr` toggle to hang a window off — they cap how often a background revalidation
fires (leading-edge-then-coalesce, or fire-after-quiet respectively). They pair
with the same wrap-time guard as the `swr` window: set one, not both.
*/
export type CacheOptions = {
    ttl?: number
    tags?: string[]
    shared?: boolean
    swr?: boolean | { throttle?: number; debounce?: number }
    throttle?: number
    debounce?: number
}
