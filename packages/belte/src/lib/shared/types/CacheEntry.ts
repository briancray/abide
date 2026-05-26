/*
Stored shape per cache key. `request` is retained so SSR snapshot
serialization can record the URL and method without re-deriving them from
the function. `ttl`/`expiresAt` drive eviction: expiresAt = undefined means
"no TTL" (lives forever); ttl = 0 means "dedupe only" (entry is pruned as
soon as the promise settles). The stored promise resolves to the raw
Response so the snapshot can read its status/headers/body; the cache
layer hands callers a decoded view derived from this same promise.
*/
export type CacheEntry = {
    key: string
    promise: Promise<Response>
    request: Request
    ttl: number | undefined
    expiresAt: number | undefined
}
