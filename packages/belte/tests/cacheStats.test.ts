import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { globalCacheStoreSlot } from '../src/lib/shared/globalCacheStoreSlot.ts'

describe('cache read stats', () => {
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
        globalCacheStoreSlot.resolver = undefined
    })

    test('miss, coalesced join, then hit tally in order', async () => {
        let release: (value: number) => void = () => undefined
        const slow = () => new Promise<number>((resolve) => (release = resolve))
        const stats = () => cacheStoreSlot.fallback!.stats

        const first = cache(slow)()
        expect(stats()).toEqual({ hits: 0, misses: 1, coalesced: 0 })
        // Same key while in flight — a coalesced join, not a hit.
        const second = cache(slow)()
        expect(stats()).toEqual({ hits: 0, misses: 1, coalesced: 1 })
        release(7)
        expect(await first).toBe(7)
        expect(await second).toBe(7)
        // Settled and retained (no ttl) — the next read is a hit.
        await cache(slow)()
        expect(stats()).toEqual({ hits: 1, misses: 1, coalesced: 1 })
    })

    test('global reads attribute to the requesting store, not the global one', async () => {
        const globalStore = createCacheStore()
        globalCacheStoreSlot.resolver = () => globalStore
        const fetchRates = () => Promise.resolve(1.08)
        await cache(fetchRates, { global: true })()
        // Data lands in the global store; the tally lands in the asker's store.
        expect(globalStore.entries.size).toBe(1)
        expect(globalStore.stats).toEqual({ hits: 0, misses: 0, coalesced: 0 })
        expect(cacheStoreSlot.fallback!.stats.misses).toBe(1)
    })
})
