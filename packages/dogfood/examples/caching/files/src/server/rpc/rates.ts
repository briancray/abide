import { GET, memo } from 'abide/server'
import { fetchRate } from '#server/rates'

// `global` is the only thing that makes two CALLERS one load, and
// it outlives every request — so anything caller-specific belongs
// in the args. `principal` does not bound it.
const exchangeRate = memo(
    ({ pair }: { pair: string }) => fetchRate(pair),
    { global: true, ttl: 60_000 },
)

// No rung on this one, so the answer is reachable unauthenticated
// and `cache-control` comes out `public, max-age=60` — the ttl
// above, in the units a cache reads, written once.
export const getRate = GET(exchangeRate)
