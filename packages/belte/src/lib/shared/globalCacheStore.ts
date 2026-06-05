import { activeCacheStore } from './activeCacheStore.ts'
import { globalCacheStoreSlot } from './globalCacheStoreSlot.ts'
import type { CacheStore } from './types/CacheStore.ts'

/*
Resolves the process-level CacheStore that `cache(fn, { global: true })` entries
live in. The server entry registers a module-singleton resolver so the store
survives across requests; the client points it at the active tab store. When no
resolver is registered (isolated tests, or a client that never set one) it falls
back to the active store, so `global` degrades to request/tab-scoped rather than
throwing.
*/
export function globalCacheStore(): CacheStore {
    return globalCacheStoreSlot.resolver?.() ?? activeCacheStore()
}
