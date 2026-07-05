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

Streaming reads (jsonl/sse):
- `n` — how many retained frames to replay before going live.
*/
export type SmartReadOptions = {
    ttl?: number
    tags?: string[]
    throttle?: number
    debounce?: number
    n?: number
}
