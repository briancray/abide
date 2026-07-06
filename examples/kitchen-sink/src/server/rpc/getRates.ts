import { error } from '@abide/abide/server/error'
import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { reachable } from '@abide/abide/server/reachable'

type Rates = { base: string; date: string; rates: Record<string, number> }

/*
A GET rpc that fronts an external exchange-rate API. The bare call on a consumer
IS the smart cached read — `getRates({ base }, { ttl: 60_000 })` coalesces
in-flight duplicates, retains the value, and refetches once it goes stale — so
the endpoint itself just performs the upstream fetch and hands back a plain Rates
JSON body. No `cache()` wrapper: the retention/coalesce/probe machinery now lives
on the bare call the reader makes, keyed by method+url+args.
*/
export const getRates = GET(async ({ base = 'USD' }: { base?: string }) => {
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
})

/*
Refetch this upstream from anywhere with `refresh(getRates)` (or
`getRates.refresh()`) — refresh keeps the stale rates on screen and revalidates
in the background, flipping `refreshing(getRates)` true meanwhile. Bound a
consumer's staleness with a `ttl` on the read so the upstream is hit at most once
per window.
*/
