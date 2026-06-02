/*
Options for cache(). `key` overrides the auto-derived WeakMap key — useful
when sharing entries across calls or stripping noisy args. `ttl` is the
milliseconds-past-resolve that the entry stays live: omitted = forever, 0 =
dedupe only (entry dropped once the promise settles), any other number = TTL.
`scope` is a free-form tag grouping unrelated calls so one
`cache.invalidate({ scope })` drops them together.
*/
export type CacheOptions = {
    key?: string | unknown[] | Record<string, unknown>
    ttl?: number
    scope?: string
}
