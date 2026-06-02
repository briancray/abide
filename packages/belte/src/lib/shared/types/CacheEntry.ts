/*
Stored shape per cache key. `request` is retained so SSR snapshot
serialization can record the URL and method without re-deriving them from
the function. `ttl`/`expiresAt` drive eviction: expiresAt = undefined means
"no TTL" (lives forever); ttl = 0 means "dedupe only" (entry is pruned as
soon as the promise settles). The stored promise resolves to the raw
Response so the snapshot can read its status/headers/body; the cache
layer hands callers a decoded view derived from this same promise.

`value` is set only for entries hydrated from the SSR snapshot: the
snapshot body is pre-decoded synchronously so the first client render can
read it without a microtask hop and byte-match the SSR DOM. Live fetches
leave it undefined and take the async decode path.

`scope` mirrors the cache() call's `scope` option so
`cache.invalidate({ scope })` can drop every entry sharing the tag.
*/
export type CacheEntry = {
    key: string
    promise: Promise<Response>
    request: Request
    ttl: number | undefined
    expiresAt: number | undefined
    value?: unknown
    scope?: string
}
