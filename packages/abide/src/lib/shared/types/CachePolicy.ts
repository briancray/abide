/*
Endpoint cache policy, declared once on the rpc definition (ADR-0020). Same value
shape as the producer-side `CacheOptions` (`ttl` / `tags` / `throttle` / `debounce`
/ `shared`, no `swr` — SWR is unconditional for replayable reads), except `tags`
also accepts an arg-derived function so the group can vary by call. That makes the
type generic over the rpc's `Args`: `(args) => ['rates:' + args.base]` is typed
against the endpoint's own argument shape.

- `ttl` — retention/staleness in ms, interpreted per side (server expiry vs client
  staleness deadline). Default 0 on the server (coalesce-only), Infinity on a
  replayable client read.
- `tags` — static invalidation-group labels, or a function of the call's args.
- `throttle` / `debounce` — the background refetch clock (set one, not both).
- `shared` — opt the entry into the process-level store (never per-user data — the
  store is keyed by method+url+args, not by user). A client no-op (one tab store).
*/
export type CachePolicy<Args> = {
    ttl?: number
    tags?: string[] | ((args: Args) => string[])
    throttle?: number
    debounce?: number
    shared?: boolean
}
