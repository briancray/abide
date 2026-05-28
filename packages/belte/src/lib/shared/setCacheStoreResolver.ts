import { cacheStoreSlot } from './cacheStoreSlot.ts'
import type { CacheStore } from './types/CacheStore.ts'

export function setCacheStoreResolver(fn: () => CacheStore | undefined): void {
    cacheStoreSlot.resolver = fn
}
