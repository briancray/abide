/*
Options for cache(). The key is always auto-derived (method+url+args for a remote
function, producer-reference+args for a plain producer): hoist a producer to a
stable reference to share its entry across calls. `ttl` is the
milliseconds-past-resolve that the entry stays live: omitted = forever, 0 =
dedupe only (entry dropped once the promise settles — the mutation idiom:
in-flight coalescing and pending() visibility, nothing retained), any other
number = TTL.
`scope` is one or more free-form tags grouping unrelated calls so one
`cache.invalidate({ scope })` drops every entry sharing any of them — pass an
array when a call belongs to multiple invalidation groups. A unique tag (e.g. a
uuid) shared by a set of calls gives them their own private invalidation group.

`global` opts the entry into the process-level store instead of the default
request-scoped one (server) — so a value computed in one request is reused by
later requests, e.g. memoising an external endpoint the server calls. Omit it
for per-request data: the default keeps a per-user response from leaking across
requests. Write only `global: true`; there is no `false` form. On the client
there is a single tab store, so the flag is a no-op there.

`invalidate` controls how a `cache.invalidate` hit on this key is applied, in ms.
`{ throttle: N }` refetches on the leading edge then at most once per N ms while
invalidations keep arriving; `{ debounce: N }` refetches only after N ms of
quiet. Both coalesce a burst of invalidations (e.g. a socket spraying
`cache.invalidate`) into far fewer calls and keep serving the existing (stale)
value until the refetch resolves — stale-while-revalidate. They affect only the
refetch-after-invalidate; the first fetch and arg-change fetches stay immediate.
A policy declares the call safe to re-run unprompted: cache() throws at wrap
time on both set at once, on ttl: 0 (nothing retained, nothing to revalidate),
and on a non-replayable remote method (replaying a write is a state change
disguised as a refresh). Producers are uncheckable — declare a policy only on
a producer that is a pure read.
*/
export type CacheOptions = {
    ttl?: number
    scope?: string | string[]
    global?: boolean
    invalidate?: { throttle?: number; debounce?: number }
}
