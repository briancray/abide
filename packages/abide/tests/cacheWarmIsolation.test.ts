import { afterEach, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { keyForRemoteCall } from '../src/lib/shared/keyForRemoteCall.ts'
import type { CacheStore } from '../src/lib/shared/types/CacheStore.ts'

/*
A warm cache entry (the SSR-decoded value) resolves on a microtask from the
decoded variant. Each read must resolve to its own clone — a live fetch hands
every reader a fresh object, so a warm read can't hand back one shared reference
that one reader could mutate and corrupt for the others (and the hydrated state).
*/
describe('warm cache reads are isolated per reader', () => {
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
    })

    test('mutating a warm read does not affect the stored value or other readers', async () => {
        const getValue = defineRpc('GET', '/rpc/warm-probe', () => json({ items: [1, 2, 3] }))
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
        const first = (await read()) as { items: number[] }
        const second = (await read()) as { items: number[] }

        // Distinct objects, equal contents.
        expect(first).not.toBe(second)
        expect(first).toEqual({ items: [1, 2, 3] })

        // Mutating one reader's copy leaves the others and the store untouched.
        first.items.push(99)
        expect(second.items).toEqual([1, 2, 3])
        expect(((await read()) as { items: number[] }).items).toEqual([1, 2, 3])
    })

    /*
    Guards against a shallow-copy regression: the clone must be DEEP. A shallow
    copy (or a shallow Object.freeze swapped in for the clone) would share the
    nested object/array references, so a nested mutation by one reader would
    corrupt the stored value and every other reader.
    */
    test('a nested mutation in one reader does not leak into the store or siblings', async () => {
        const getValue = defineRpc('GET', '/rpc/warm-nested', () =>
            json({ page: { rows: [{ id: 1 }] } }),
        )
        const store: CacheStore = createCacheStore()
        cacheStoreSlot.resolver = () => store

        const key = keyForRemoteCall(getValue.raw.method, getValue.raw.url, undefined)
        const stored = { page: { rows: [{ id: 1 }] } }
        store.entries.set(key, {
            key,
            promise: Promise.resolve(Response.json(stored)),
            request: new Request('https://test.local/rpc/warm-nested', { method: 'GET' }),
            ttl: undefined,
            expiresAt: undefined,
            value: stored,
            settled: true,
        })

        const read = cache(getValue)
        const first = (await read()) as { page: { rows: Array<{ id: number }> } }
        const second = (await read()) as { page: { rows: Array<{ id: number }> } }

        // Distinct nested references — a deep copy, not a shared subtree.
        expect(first.page).not.toBe(second.page)
        expect(first.page.rows).not.toBe(second.page.rows)

        // Deep mutation on one reader leaves the store value and siblings intact.
        first.page.rows[0].id = 999
        first.page.rows.push({ id: 2 })
        expect(second.page.rows).toEqual([{ id: 1 }])
        expect(stored.page.rows).toEqual([{ id: 1 }])
        expect(((await read()) as typeof first).page.rows).toEqual([{ id: 1 }])
    })

    /*
    A scalar warm value (text body / scalar json) is an immutable primitive: it
    is returned without a copy, so two reads share the same value and there is
    nothing to corrupt. Pins the no-clone fast path.
    */
    test('a scalar warm value is served without cloning', async () => {
        const getValue = defineRpc('GET', '/rpc/warm-scalar', () => json(7))
        const store: CacheStore = createCacheStore()
        cacheStoreSlot.resolver = () => store

        const key = keyForRemoteCall(getValue.raw.method, getValue.raw.url, undefined)
        store.entries.set(key, {
            key,
            promise: Promise.resolve(Response.json(7)),
            request: new Request('https://test.local/rpc/warm-scalar', { method: 'GET' }),
            ttl: undefined,
            expiresAt: undefined,
            value: 7,
            settled: true,
        })

        const read = cache(getValue)
        expect(await read()).toBe(7)
        expect(await read()).toBe(7)
    })
})
