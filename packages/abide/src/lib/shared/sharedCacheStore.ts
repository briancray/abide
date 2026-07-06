import { activeCacheStore } from './activeCacheStore.ts'
import { sharedCacheStoreSlot } from './sharedCacheStoreSlot.ts'
import type { CacheStore } from './types/CacheStore.ts'

/*
Resolves the process-level ("shared") CacheStore that `cache(fn, { shared: true })`
entries live in. The server entry registers a module-singleton resolver so the
store survives across requests; the client points it at the active tab store.
When no resolver is registered it falls back to the active store, so `shared`
degrades to request/tab-scoped rather than throwing.
*/
export function sharedCacheStore(): CacheStore {
    return sharedCacheStoreSlot.resolver?.() ?? activeCacheStore()
}
