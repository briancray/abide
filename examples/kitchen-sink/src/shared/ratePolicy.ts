/*
Endpoint cache policy for `getRates`, declared in a SHARED module and imported by the rpc
definition. This proves ADR-0022: the client rpc transform keeps the real module and leaves the
endpoint `opts` as a live expression, so policy can reference imported values — the old
"self-contained policy" text-splice constraint (where a client stub carried none of the module's
imports) is gone. `RATE_TTL` and `ratePolicy` both flow into the client bundle unchanged; the
handler's server-only code does not.
*/

/* Staleness bound: a consumer hits the upstream at most once per minute. */
export const RATE_TTL = 60_000

/* The full endpoint cache policy — imported wholesale by `getRates`. `ttl` bounds staleness,
   `debounce` coalesces a burst of refresh() calls into one background refetch, and `tags` groups
   the entry by base so `cache.invalidate({ tags: ['rates:EUR'] })` reaches exactly it. */
export const ratePolicy = {
    ttl: RATE_TTL,
    debounce: 300,
    tags: (args: { base?: string }) => [`rates:${args?.base ?? 'USD'}`],
}
