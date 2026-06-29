import { createCacheStore } from './createCacheStore.ts'
import { createResolverSlot } from './createResolverSlot.ts'
import type { CacheStore } from './types/CacheStore.ts'

/*
The active-CacheStore slot/resolver/reader bundle. The server entry installs an
ALS-backed resolver (request-scoped); the client entry a module-singleton one.
With no resolver registered, a single fallback store is created lazily so
isolated tests work without booting the runtime. cacheStoreSlot / activeCacheStore
re-export the slot and reader; setCacheStoreResolver the setter.
*/
export const cacheStoreResolver = createResolverSlot<CacheStore>(createCacheStore)
