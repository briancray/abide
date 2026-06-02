import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/browser/cache.ts'
import type { HttpVerb } from '../src/lib/server/rpc/types/HttpVerb.ts'
import type { RawRemoteFunction } from '../src/lib/server/rpc/types/RawRemoteFunction.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { remoteMetaStore } from '../src/lib/shared/remoteMetaStore.ts'

/* Minimal raw remote function that records request meta so cache() accepts it. */
function fakeRemote<Args>(method: HttpVerb, url: string): RawRemoteFunction<Args> {
    const fn = ((args: Args) => {
        const search = args ? `?${new URLSearchParams(args as Record<string, string>)}` : ''
        const request = new Request(`https://test.local${url}${search}`, { method })
        const promise = Promise.resolve(
            new Response(JSON.stringify(args ?? null), {
                headers: { 'content-type': 'application/json' },
            }),
        )
        remoteMetaStore.set(promise, () => request)
        return promise
    }) as RawRemoteFunction<Args>
    Object.assign(fn, { method, url })
    return fn
}

describe('cache.invalidate selector', () => {
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
    })

    test('{ scope } drops every entry tagged with the scope, leaving others', async () => {
        const getPosts = fakeRemote<undefined>('GET', '/rpc/posts')
        const getTags = fakeRemote<undefined>('GET', '/rpc/tags')
        const getUser = fakeRemote<undefined>('GET', '/rpc/user')
        const store = cacheStoreSlot.fallback!

        await cache(getPosts, { scope: 'dashboard' })()
        await cache(getTags, { scope: 'dashboard' })()
        await cache(getUser, { scope: 'profile' })()
        expect(store.entries.size).toBe(3)

        cache.invalidate({ scope: 'dashboard' })

        expect(Array.from(store.entries.keys())).toEqual(['GET /rpc/user'])
    })

    test('{ scope } notifies subscribers of every affected key', async () => {
        const getPosts = fakeRemote<undefined>('GET', '/rpc/posts')
        const store = cacheStoreSlot.fallback!
        await cache(getPosts, { scope: 'dashboard' })()

        let notified: Set<string> | undefined
        store.events.addEventListener('invalidate', (event) => {
            notified = (event as CustomEvent<Set<string>>).detail
        })

        cache.invalidate({ scope: 'dashboard' })
        expect(notified?.has('GET /rpc/posts')).toBe(true)
    })

    test('unknown scope is a no-op without dispatching an event', async () => {
        const getPosts = fakeRemote<undefined>('GET', '/rpc/posts')
        const store = cacheStoreSlot.fallback!
        await cache(getPosts, { scope: 'dashboard' })()

        let dispatched = false
        store.events.addEventListener('invalidate', () => {
            dispatched = true
        })

        cache.invalidate({ scope: 'nonexistent' })
        expect(dispatched).toBe(false)
        expect(store.entries.size).toBe(1)
    })

    test('{ key } drops the single entry stored under that key override', async () => {
        const getPosts = fakeRemote<undefined>('GET', '/rpc/posts')
        const getTags = fakeRemote<undefined>('GET', '/rpc/tags')
        const store = cacheStoreSlot.fallback!

        await cache(getPosts, { key: 'home-feed' })()
        await cache(getTags, { key: 'sidebar' })()
        expect(store.entries.size).toBe(2)

        cache.invalidate({ key: 'home-feed' })
        expect(Array.from(store.entries.keys())).toEqual(['sidebar'])
    })

    test('{ key, scope } drops the union of both criteria', async () => {
        const getPosts = fakeRemote<undefined>('GET', '/rpc/posts')
        const getTags = fakeRemote<undefined>('GET', '/rpc/tags')
        const getUser = fakeRemote<undefined>('GET', '/rpc/user')
        const store = cacheStoreSlot.fallback!

        await cache(getPosts, { key: 'home-feed' })()
        await cache(getTags, { scope: 'dashboard' })()
        await cache(getUser, { scope: 'profile' })()

        cache.invalidate({ key: 'home-feed', scope: 'dashboard' })
        expect(Array.from(store.entries.keys())).toEqual(['GET /rpc/user'])
    })

    test('a re-read with a scope tags an entry that was created without one', async () => {
        const getPosts = fakeRemote<undefined>('GET', '/rpc/posts')
        const store = cacheStoreSlot.fallback!

        await cache(getPosts)()
        expect(store.entries.get('GET /rpc/posts')?.scope).toBeUndefined()

        await cache(getPosts, { scope: 'dashboard' })()
        expect(store.entries.get('GET /rpc/posts')?.scope).toBe('dashboard')

        cache.invalidate({ scope: 'dashboard' })
        expect(store.entries.size).toBe(0)
    })
})
