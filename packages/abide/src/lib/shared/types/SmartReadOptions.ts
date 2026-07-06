/*
Second-argument options for the smart bare rpc call (`getFoo(args, opts)`). The
call is cached/coalesced/reactive with SWR always on for replayable reads, so
these govern retention and the refetch clock — NOT transport. Per-call transport
options (signal/keepalive/priority/cache/headers) live on `.raw(args, init)`.

Fetch reads:
- `ttl` — retention/staleness in ms: undefined = retain forever (no auto-refetch),
  N ms = the retained value goes stale after N ms and the next access triggers a
  background revalidation (stale stays visible, `refreshing()` true). The display
  value is never dropped; ttl drives staleness, not eviction.
- `tags` — free-form invalidation-group labels (see the selector grammar).
- `throttle` / `debounce` — rate-limit the background refetch clock (set one, not
  both). Leading-edge-then-coalesce, or fire-after-quiet respectively.
- `shared` — opts the entry into the process-level store instead of the default
  request-scoped one (server) — a store that outlives every request. It selects
  the store only; it does NOT retain (pair it with `ttl` to memoise across
  requests). The shared store is keyed by method+url+args, never by user, so do
  not put per-user data in it — it would be served to other users. Omit `shared`
  for per-request data. Write only `shared: true`; there is no `false` form. On
  the client there is a single tab store, so the flag is a no-op there.

Streaming reads (jsonl/sse):
- `n` — how many retained frames to replay before going live.
*/
export type SmartReadOptions = {
    ttl?: number
    tags?: string[]
    throttle?: number
    debounce?: number
    shared?: boolean
    n?: number
}
