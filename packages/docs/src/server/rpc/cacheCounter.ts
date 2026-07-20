import { GET } from 'abide/server/GET'

// A read RPC whose handler counts how many times it actually RAN, per `key`. The client-side cell
// proxy caches by args, so repeated reads reuse one result and `runs` stays put; `refresh` and
// `invalidate` force a re-fetch and the count climbs — the whole point of the cache demo, proven
// against a real isomorphic fetch (in-proc on the server, HTTP from the browser).
const runsByKey = new Map<string, number>()

export default GET(({ key = 'alpha' }: { key?: string }) => {
    const next = (runsByKey.get(key) ?? 0) + 1
    runsByKey.set(key, next)
    return { key, runs: next }
})
