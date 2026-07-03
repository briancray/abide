import { afterEach, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheEntryFromSnapshot } from '../src/lib/shared/cacheEntryFromSnapshot.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { keyForRemoteCall } from '../src/lib/shared/keyForRemoteCall.ts'
import type { CacheSnapshotEntry } from '../src/lib/shared/types/CacheSnapshotEntry.ts'

afterEach(() => {
    cacheStoreSlot.resolver = undefined
    cacheStoreSlot.fallback = undefined
})

const snapshot = (overrides: Partial<CacheSnapshotEntry> = {}): CacheSnapshotEntry => ({
    key: 'GET https://x/users',
    url: 'https://x/users',
    method: 'GET',
    status: 200,
    statusText: 'OK',
    headers: [['content-type', 'application/json']],
    body: JSON.stringify([{ id: 1 }]),
    ...overrides,
})

describe('lazy cache seed', () => {
    test('eager seed decodes the value up front', () => {
        const entry = cacheEntryFromSnapshot(snapshot())
        expect(entry.value).toEqual([{ id: 1 }])
        expect(entry.warm).toBeUndefined()
    })

    test('lazy seed decodes nothing until first read', () => {
        const entry = cacheEntryFromSnapshot(snapshot({ lazy: true }))
        /* Boot: no decode — value absent, materializer parked. */
        expect(entry.value).toBeUndefined()
        expect(typeof entry.warm).toBe('function')
        /* First materialization decodes; the result is cached for reuse. */
        expect(entry.warm?.()).toEqual([{ id: 1 }])
        expect(entry.warm?.()).toBe(entry.warm?.())
    })

    test('a lazy-seeded entry reads warm through cache(), memoizing the value', async () => {
        let handlerCalls = 0
        const getUsers = defineRpc('GET', '/rpc/lazy-users', () => {
            handlerCalls += 1
            return json([{ id: 1 }])
        })
        const key = keyForRemoteCall('GET', '/rpc/lazy-users', undefined)
        const store = createCacheStore()
        cacheStoreSlot.resolver = () => store
        store.entries.set(
            key,
            cacheEntryFromSnapshot(snapshot({ key, url: 'https://x/rpc/lazy-users', lazy: true })),
        )

        expect(store.entries.get(key)?.value).toBeUndefined() // not decoded before any read

        const value = await cache(getUsers)()
        expect(value).toEqual([{ id: 1 }])
        expect(handlerCalls).toBe(0) // served warm, no live dispatch
        expect(store.entries.get(key)?.value).toEqual([{ id: 1 }]) // decode cached onto the entry
    })
})
