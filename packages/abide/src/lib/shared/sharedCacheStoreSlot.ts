import { createResolverSlot } from './createResolverSlot.ts'
import type { CacheStore } from './types/CacheStore.ts'

/*
The process-level ("shared") CacheStore slot that `cache(fn, { shared: true })`
entries live in. The server entry registers a module-singleton store outliving
every request; the client points it at the active tab store. When no resolver
is registered, sharedCacheStore() falls back to the active store.
*/
export const sharedCacheStoreSlot = createResolverSlot<CacheStore>()
