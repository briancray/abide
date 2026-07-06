import { createCacheStore } from './createCacheStore.ts'
import { createResolverSlot } from './createResolverSlot.ts'
import type { CacheStore } from './types/CacheStore.ts'

/*
The active-CacheStore slot. The server entry installs an ALS-backed resolver
(request-scoped); the client entry a module-singleton one. With no resolver
registered, a single fallback store is created lazily so isolated tests work
without booting the runtime; test helpers snapshot/poke `.resolver` and
`.fallback` directly. activeCacheStore is the public read.
*/
export const cacheStoreSlot = createResolverSlot<CacheStore>(createCacheStore)
