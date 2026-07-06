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
- `global` — store the entry in the process-level store instead of the default
  request-scoped one (server), so a value computed in one request is reused by
  later requests — the memoise-an-external-endpoint case. Omit it for per-user
  data: the default keeps a per-user response from leaking across requests.
  Write only `global: true`; there is no `false` form. On the client there is a
  single tab store, so the flag is a no-op there.

Streaming reads (jsonl/sse):
- `n` — how many retained frames to replay before going live.
*/
export type SmartReadOptions = {
    ttl?: number
    tags?: string[]
    throttle?: number
    debounce?: number
    global?: boolean
    n?: number
}
