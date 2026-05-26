import type { CacheStore } from './types/CacheStore.ts'
import { cacheStoreSlot } from './cacheStoreSlot.ts'

export function setCacheStoreResolver(fn: () => CacheStore | undefined): void {
    cacheStoreSlot.resolver = fn
}
