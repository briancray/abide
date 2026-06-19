import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { globalCacheStoreSlot } from '../src/lib/shared/globalCacheStoreSlot.ts'
import { settle } from './support/settle.ts'

/* A producer reporting its own invocation count, so a dedupe holds the count
   steady and a miss bumps it. */
function counter(): () => Promise<number> {
    let calls = 0
    return () => Promise.resolve(++calls)
}

describe('cache() producer', () => {
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
        globalCacheStoreSlot.resolver = undefined
    })

    test('dedupes by producer reference', async () => {
        const fetchValue = counter()
        const first = await cache(fetchValue)()
        const second = await cache(fetchValue)()
        expect(first).toBe(1)
        expect(second).toBe(1)
        expect(cacheStoreSlot.fallback!.entries.size).toBe(1)
    })

    test('distinct references do not share an entry', async () => {
        await cache(counter())()
        await cache(counter())()
        expect(cacheStoreSlot.fallback!.entries.size).toBe(2)
    })

    test('args fold into the key so the same producer keys per-arg', async () => {
        const double = (n?: number) => Promise.resolve((n ?? 0) * 2)
        expect(await cache(double)(2)).toBe(4)
        expect(await cache(double)(3)).toBe(6)
        expect(cacheStoreSlot.fallback!.entries.size).toBe(2)
    })

    test('a producer with an incidental url prop stays a producer (brand, not shape, decides)', async () => {
        const fetchValue = Object.assign(counter(), { url: '/looks/remote', method: 'GET' })
        const first = await cache(fetchValue)()
        const second = await cache(fetchValue)()
        expect(first).toBe(1)
        expect(second).toBe(1)
        const entry = Array.from(cacheStoreSlot.fallback!.entries.values())[0]
        expect(entry.request).toBeUndefined()
    })

    test('stores the value promise directly — no Response, no request metadata', async () => {
        const fetchValue = counter()
        await cache(fetchValue)()
        const entry = Array.from(cacheStoreSlot.fallback!.entries.values())[0]
        expect(entry.request).toBeUndefined()
        expect(await entry.promise).toBe(1)
    })

    test('invalidate by producer reference drops its entries', async () => {
        const fetchValue = counter()
        await cache(fetchValue)()
        cache.invalidate(fetchValue)
        expect(cacheStoreSlot.fallback!.entries.size).toBe(0)
        /* Next read recomputes. */
        expect(await cache(fetchValue)()).toBe(2)
    })

    test('invalidate by tag drops tagged producer entries', async () => {
        const fetchValue = counter()
        await cache(fetchValue, { tags: 'external' })()
        cache.invalidate({ tags: 'external' })
        expect(cacheStoreSlot.fallback!.entries.size).toBe(0)
    })

    test('ttl=0 evicts the producer entry once it settles', async () => {
        const fetchValue = counter()
        await cache(fetchValue, { ttl: 0 })()
        await settle()
        expect(cacheStoreSlot.fallback!.entries.size).toBe(0)
    })
})

describe('cache() producer with global: true', () => {
    let globalStore = createCacheStore()
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
        globalStore = createCacheStore()
        globalCacheStoreSlot.resolver = () => globalStore
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
        globalCacheStoreSlot.resolver = undefined
    })

    test('lands in the process-level store, not the request store', async () => {
        const fetchValue = counter()
        await cache(fetchValue, { global: true })()
        expect(globalStore.entries.size).toBe(1)
        expect(cacheStoreSlot.fallback!.entries.size).toBe(0)
    })

    test('memoised value survives a new request (swapped active store)', async () => {
        const fetchValue = counter()
        const first = await cache(fetchValue, { global: true })()
        /* Simulate the next request: fresh request-scoped store, same process store. */
        cacheStoreSlot.fallback = createCacheStore()
        const second = await cache(fetchValue, { global: true })()
        expect(first).toBe(1)
        expect(second).toBe(1)
    })

    test('invalidate reaches the process-level store', async () => {
        const fetchValue = counter()
        await cache(fetchValue, { global: true })()
        cache.invalidate(fetchValue)
        expect(globalStore.entries.size).toBe(0)
    })
})
