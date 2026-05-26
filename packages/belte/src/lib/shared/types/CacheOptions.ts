/*
Options for cache(). `key` overrides the auto-derived WeakMap key — useful
when sharing entries across calls or stripping noisy args. `ttl` is the
milliseconds-past-resolve that the entry stays live: omitted = forever, 0 =
dedupe only (entry dropped once the promise settles), any other number = TTL.
*/
export type CacheOptions = {
    key?: string | unknown[] | Record<string, unknown>
    ttl?: number
}
