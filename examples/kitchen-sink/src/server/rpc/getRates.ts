import { error } from '@abide/abide/server/error'
import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { reachable } from '@abide/abide/shared/reachable'
import { ratePolicy } from '../../shared/ratePolicy.ts'

type Rates = { base: string; date: string; rates: Record<string, number> }

/*
A GET rpc that fronts an external exchange-rate API. The bare call on a consumer
IS the smart cached read — `getRates({ base })` coalesces in-flight duplicates,
retains the value, and refetches once it goes stale — so the endpoint itself just
performs the upstream fetch and hands back a plain Rates JSON body. No `cache()`
wrapper: the retention/coalesce/probe machinery lives on the bare call the reader
makes, keyed by method+url+args.

All cache policy is endpoint-declared now (ADR-0020): `ttl` bounds staleness so a
consumer hits the upstream at most once per minute, `debounce` coalesces a burst
of `refresh(getRates)` calls into one background refetch, and `tags` groups the
entry by base so `cache.invalidate({ tags: ['rates:EUR'] })` reaches exactly it.
*/
export const getRates = GET(
    async ({ base = 'USD' }: { base?: string }) => {
        /* Fail a doomed outbound call fast: reachable() HEADs the upstream origin
           (warm after the first probe, fresh within one TTL), so a down host returns
           503 here instead of every caller eating the full fetch timeout. */
        if (!(await reachable('api.frankfurter.app'))) {
            return error(503, 'rates upstream unreachable')
        }
        const response = await fetch(`https://api.frankfurter.app/latest?from=${base}`)
        if (!response.ok) {
            return error(502, `upstream ${response.status}`)
        }
        const rates = (await response.json()) as Rates
        return json(rates)
    },
    /* ADR-0022: the cache policy is an IMPORTED value from a shared module, not an inline literal.
       The client rpc transform forwards this live `opts` object, so `ratePolicy` reaches the client
       bundle while the handler above (and its server-only `error`/`json`/`reachable` imports)
       tree-shakes out. */
    { cache: ratePolicy },
)

/*
Refetch this upstream from anywhere with `refresh(getRates)` (or
`getRates.refresh()`) — refresh keeps the stale rates on screen and revalidates
in the background, flipping `refreshing(getRates)` true meanwhile. Staleness is
bounded by the endpoint's `cache.ttl` (declared above), so the upstream is hit at
most once per window regardless of how many consumers read it.
*/
