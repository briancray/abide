import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import type { CacheStore } from '../src/lib/shared/types/CacheStore.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { installMiniDom } from './support/installMiniDom.ts'
import { settle } from './support/settle.ts'

/*
Locks the "return-warm" behaviour the router's teardown model depends on: the page
is torn down on every navigation, but its cache entries live in the module-level tab
store, NOT in the page scope. So back/forward to a route serves its data warm — no
refetch, no loading flash — even though the DOM was rebuilt. The entry's only tie to
a reader is its invalidate subscriber, which is removed on teardown; the entry itself
is dropped only by ttl/invalidate. This pins that a default (ttl-omitted) entry
outlives the reader, and that ttl: 0 (dedupe-only) deliberately does not.
*/
let store: CacheStore
beforeAll(() => {
    installMiniDom() // cache() no-ops without a window (tail() guard)
})
beforeEach(() => {
    store = createCacheStore()
    cacheStoreSlot.resolver = () => store
})
afterEach(() => {
    cacheStoreSlot.resolver = undefined
    cacheStoreSlot.fallback = undefined
})

describe('cache() return-warm across page teardown', () => {
    test('a default entry survives the reading scope and serves warm on return', async () => {
        let runs = 0
        const load = (): Promise<string> => {
            runs += 1
            return Promise.resolve('payload')
        }

        /* Page 1 mounts and reads the cache inside its reactive scope (the subscriber
           registers this reader). */
        let read: Promise<unknown> | undefined
        const disposePage1 = effect(() => {
            read = cache(load)
        })
        await settle()
        expect(runs).toBe(1) // cold miss fetched once
        expect(await read).toBe('payload')

        /* Page 1 tears down on navigation away — the subscriber's deferred close runs. */
        disposePage1()
        await settle()

        /* Page 2 mounts on return: same producer, same key. */
        const disposePage2 = effect(() => {
            read = cache(load)
        })
        await settle()
        expect(runs).toBe(1) // WARM — served from the surviving entry, never refetched
        expect(await read).toBe('payload')
        disposePage2()
    })

    test('a ttl: 0 entry is dropped on settle, so the next page is a cold miss', async () => {
        let runs = 0
        const load = (): Promise<string> => {
            runs += 1
            return Promise.resolve(`v${runs}`)
        }

        let read: Promise<unknown> | undefined
        const disposePage1 = effect(() => {
            read = cache(load, undefined, { ttl: 0 })
        })
        await settle()
        expect(await read).toBe('v1')
        disposePage1()
        await settle()

        const disposePage2 = effect(() => {
            read = cache(load, undefined, { ttl: 0 })
        })
        await settle()
        expect(runs).toBe(2) // cold — ttl: 0 retains nothing past settle
        expect(await read).toBe('v2')
        disposePage2()
    })
})
