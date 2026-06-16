import { globalCacheStoreSlot } from './globalCacheStoreSlot.ts'
import type { CacheStore } from './types/CacheStore.ts'

export function setGlobalCacheStoreResolver(fn: () => CacheStore | undefined): void {
    globalCacheStoreSlot.resolver = fn
}
