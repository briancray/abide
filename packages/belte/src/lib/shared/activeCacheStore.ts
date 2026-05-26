import type { CacheStore } from './types/CacheStore.ts'
import { cacheStoreSlot } from './cacheStoreSlot.ts'
import { createCacheStore } from './createCacheStore.ts'

/*
Resolves the active CacheStore. The runtime is registered via
`setCacheStoreResolver` from the server entry (request-scoped via ALS)
or the client entry (module-level singleton). If no resolver is registered,
a single fallback store is created lazily so isolated tests still work.
*/
export function activeCacheStore(): CacheStore {
    const fromResolver = cacheStoreSlot.resolver?.()
    if (fromResolver) {
        return fromResolver
    }
    if (!cacheStoreSlot.fallback) {
        cacheStoreSlot.fallback = createCacheStore()
    }
    return cacheStoreSlot.fallback
}
