import { cacheKeyStore } from './cacheKeyStore.ts'

/* The store key behind a cache() read's promise, or undefined if it carries none
   (a producer read, a raw Response read, or a non-cache promise). */
export function cacheKeyOf(promise: Promise<unknown>): string | undefined {
    return cacheKeyStore.get(promise)
}
