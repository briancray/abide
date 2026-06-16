import type { CacheInvalidation } from './types/CacheInvalidation.ts'

/*
Constructs the cache store's 'invalidate' event from the keys an
invalidation touched. The single definition of the event name + detail
shape, so the two dispatch sites (cache.invalidate and the streamed-
resolution placeholder settle) can't drift from the cache store's listener.
*/
export function invalidateEvent(keys: Iterable<string>): CustomEvent<CacheInvalidation> {
    return new CustomEvent('invalidate', { detail: new Set(keys) })
}
