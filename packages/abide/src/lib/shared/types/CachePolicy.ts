/*
Endpoint cache policy, declared once on the rpc definition (ADR-0020). Same value
shape as the producer-side `CacheOptions` (`ttl` / `tags` / `throttle` / `debounce`
/ `shared` / `errorTtl`, no `swr` — SWR is unconditional for replayable reads),
except `tags` also accepts an arg-derived function so the group can vary by call.
That makes the type generic over the rpc's `Args`: `(args) => ['rates:' + args.base]`
is typed against the endpoint's own argument shape.

- `ttl` — retention/staleness in ms. Default Infinity: the entry is retained for its
  store's lifetime — the request on the server (a non-shared read dies with the request,
  regardless of ttl), the tab on the client (until invalidate/refresh). An explicit ttl
  is a hard expiry on the server, a staleness deadline (SWR) on the client.
- `tags` — static invalidation-group labels, or a function of the call's args.
- `throttle` / `debounce` — the background refetch clock (set one, not both).
- `shared` — opt the entry into the process-level store (never per-user data — the store
  is keyed by method+url+args, not by user). With the default Infinity ttl this memoises
  across requests; an explicit ttl bounds it. A client no-op (one tab store).
- `errorTtl` — negative-cache window in ms: retain a failed load for that long (reads
  within it re-surface the rejection with no network) instead of the default
  evict-and-retry, then hard-evict. A function of the failed status (0 = network fault)
  returns a per-status window or `undefined` to keep the immediate-retry default for that
  status; a `Retry-After` header overrides the number. Off when unset.
*/
export type CachePolicy<Args> = {
    ttl?: number
    tags?: string[] | ((args: Args) => string[])
    throttle?: number
    debounce?: number
    shared?: boolean
    errorTtl?: number | ((status: number) => number | undefined)
}
