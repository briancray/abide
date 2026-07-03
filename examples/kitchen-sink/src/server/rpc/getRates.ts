import { error } from '@abide/abide/server/error'
import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { reachable } from '@abide/abide/server/reachable'
import { cache } from '@abide/abide/shared/cache'

type Rates = { base: string; date: string; rates: Record<string, number> }

/*
Hoisted producer wrapping an external fetch. The cache keys on this
function's reference + args, so a const/hoisted fn dedupes across calls;
an inline arrow would get a fresh id every call and never hit. It returns
a plain Promise<Rates> (no Response, no decode) — the producer path, not
the remote-rpc path.
*/
async function fetchRates(base = 'USD'): Promise<Rates> {
    const response = await fetch(`https://api.frankfurter.app/latest?from=${base}`)
    if (!response.ok) {
        throw new Error(`upstream ${response.status}`)
    }
    return response.json()
}

/*
Reuses the rpc cache machinery for an upstream API. `global: true` puts the
entry in the process-level store so a value fetched for one request is reused
by later requests (per-user request scoping is wrong here — the upstream is
shared); `ttl` bounds staleness so the upstream is hit at most once per minute
across the whole process. Same coalesce/ttl/invalidate/probe machinery the rpc
rpcs get — only the Response-based SSR streaming snapshot is unavailable,
since an external fetch carries no wire metadata to snapshot.
*/
export const getRates = GET(async ({ base = 'USD' }: { base?: string }) => {
    /* Fail a doomed outbound call fast: reachable() HEADs the upstream origin
       (warm after the first probe, fresh within one TTL), so a down host returns
       503 here instead of every caller eating the full fetch timeout. */
    if (!(await reachable('api.frankfurter.app'))) {
        return error(503, 'rates upstream unreachable')
    }
    const rates = await cache(fetchRates, { global: true, ttl: 60_000 })(base)
    return json(rates)
})

/*
Invalidate this upstream from anywhere with cache.invalidate(fetchRates) — the
selector matches the producer's id prefix, so the next read refetches. Works
only once fetchRates has been cached at least once (before that it has no id).
*/
