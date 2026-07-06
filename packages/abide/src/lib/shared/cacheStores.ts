import { activeCacheStore } from './activeCacheStore.ts'
import { sharedCacheStore } from './sharedCacheStore.ts'
import type { CacheStore } from './types/CacheStore.ts'

/* Active + process-level stores, deduped (one tab store on the client). */
export function cacheStores(): CacheStore[] {
    const active = activeCacheStore()
    const shared = sharedCacheStore()
    return active === shared ? [active] : [active, shared]
}
