/*
Detail payload of the cache store's 'invalidate' event — the set of cache
keys one invalidation touched. A Set so each subscriber's membership check
is O(1) regardless of how many keys a single invalidate spans. Shared
between the dispatcher (cache.invalidate) and the cache store's listener,
so the event's shape has one definition instead of an inline cast repeated
at every site.
*/
export type CacheInvalidation = Set<string>
