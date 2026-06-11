import { afterEach, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineVerb } from '../src/lib/server/rpc/defineVerb.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { keyForRemoteCall } from '../src/lib/shared/keyForRemoteCall.ts'
import type { CacheStore } from '../src/lib/shared/types/CacheStore.ts'

/*
A warm cache entry (the SSR-decoded value) is read synchronously by the decoded
variant. Each read must return its own clone — a live fetch hands every reader a
fresh object, so a warm read can't hand back one shared reference that one
reader could mutate and corrupt for the others (and the hydrated state).
*/
describe('warm cache reads are isolated per reader', () => {
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
    })

    test('mutating a warm read does not affect the stored value or other readers', () => {
        const getValue = defineVerb('GET', '/rpc/warm-probe', () => json({ items: [1, 2, 3] }))
        const store: CacheStore = createCacheStore()
        cacheStoreSlot.resolver = () => store

        const key = keyForRemoteCall(getValue.raw.method, getValue.raw.url, undefined)
        store.entries.set(key, {
            key,
            promise: Promise.resolve(Response.json({ n: 1 })),
            request: new Request('https://test.local/rpc/warm-probe', { method: 'GET' }),
            ttl: undefined,
            expiresAt: undefined,
            value: { items: [1, 2, 3] },
            settled: true,
        })

        const read = cache(getValue)
        const first = read() as { items: number[] }
        const second = read() as { items: number[] }

        // Distinct objects, equal contents.
        expect(first).not.toBe(second)
        expect(first).toEqual({ items: [1, 2, 3] })

        // Mutating one reader's copy leaves the others and the store untouched.
        first.items.push(99)
        expect(second.items).toEqual([1, 2, 3])
        expect((read() as { items: number[] }).items).toEqual([1, 2, 3])
    })
})
