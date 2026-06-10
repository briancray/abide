import { activeCacheStore } from './activeCacheStore.ts'
import { globalCacheStore } from './globalCacheStore.ts'
import type { CacheStore } from './types/CacheStore.ts'

/* Active + process-level stores, deduped (one tab store on the client). */
export function cacheStores(): CacheStore[] {
    const active = activeCacheStore()
    const global = globalCacheStore()
    return active === global ? [active] : [active, global]
}
