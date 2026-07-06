import { cacheStoreSlot } from './cacheStoreSlot.ts'
import type { CacheStore } from './types/CacheStore.ts'

/*
Resolves the active CacheStore: the registered resolver's store, or a single
lazily-created fallback when none is registered (so isolated tests work). The
fallback creator guarantees a value, hence the non-null assertion.
*/
export function activeCacheStore(): CacheStore {
    return cacheStoreSlot.get()!
}
