/*
Options for the explicit `cache(producer, args, options?)` call over a plain
producer, and the value-shape of an endpoint's `cache` policy (CachePolicy adds
only the arg-derived `tags` function form on top). A remote rpc has no options
argument any more — its policy lives on the definition (ADR-0020); this type is
the producer's only policy home. The key is always auto-derived
(producer-reference+args): hoist a producer to a stable reference to share its
entry across calls.

`ttl` is the milliseconds-past-resolve the entry stays live: 0 = dedupe only
(entry dropped once the promise settles — in-flight coalescing and pending()
visibility, nothing retained), any other number = TTL. Omitted = forever for a
producer.

`tags` is an array of free-form labels grouping unrelated calls so one
`cache.invalidate({ tags })` drops every entry sharing any of them — list
multiple when a call belongs to multiple invalidation groups. A unique tag (e.g.
a uuid) shared by a set of calls gives them their own private invalidation group.

`shared` opts the entry into the process-level store instead of the default
request-scoped one (server) — a store that outlives every request. It selects
the store only; it does NOT retain (pair it with `ttl` to memoise across
requests). The shared store is keyed by producer-reference+args, never by user,
so do not put per-user data in it — it would be served to other users. Omit
`shared` for per-request data. Write only `shared: true`; there is no `false`
form. On the client there is a single tab store, so the flag is a no-op there.

`throttle`/`debounce` arm the keep-stale-and-revalidate refetch clock for a
producer: with one set, a `cache.invalidate` hit keeps the stale value visible
and coalesces a background refetch (leading-edge-then-coalesce, or
fire-after-quiet respectively) instead of dropping the entry. Set one, not both.
SWR is otherwise unconditional for replayable remote reads; there is no `swr`
toggle.
*/
export type CacheOptions = {
    ttl?: number
    tags?: string[]
    shared?: boolean
    throttle?: number
    debounce?: number
}
