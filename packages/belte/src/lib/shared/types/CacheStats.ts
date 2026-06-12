/*
Per-store cache read tallies, frozen into the request's closing log record at
settle. hit = a read served from a settled retained entry (including the warm
SSR sync path); coalesced = a read that joined an in-flight call; miss = a
read that invoked its producer/remote. Reads against the process-level global
store count into the requesting scope's store, so a request's record reflects
everything that request asked the cache for.
*/
export type CacheStats = {
    hits: number
    misses: number
    coalesced: number
}
