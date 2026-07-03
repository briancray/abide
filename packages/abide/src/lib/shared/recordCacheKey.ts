import { cacheKeyStore } from './cacheKeyStore.ts'

/* Tags a cache() read's returned promise with its store key (see cacheKeyStore). */
export function recordCacheKey(promise: Promise<unknown>, key: string): void {
    cacheKeyStore.set(promise, key)
}
