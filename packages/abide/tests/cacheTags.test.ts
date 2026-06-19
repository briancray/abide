import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { REMOTE_FUNCTION } from '../src/lib/shared/REMOTE_FUNCTION.ts'
import { remoteMetaStore } from '../src/lib/shared/remoteMetaStore.ts'
import type { CacheInvalidation } from '../src/lib/shared/types/CacheInvalidation.ts'
import type { HttpVerb } from '../src/lib/shared/types/HttpVerb.ts'
import type { RawRemoteFunction } from '../src/lib/shared/types/RawRemoteFunction.ts'

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
    Object.assign(fn, { method, url, [REMOTE_FUNCTION]: true })
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

    test('{ tags } drops every entry carrying the tag, leaving others', async () => {
        const getPosts = fakeRemote<undefined>('GET', '/rpc/posts')
        const getTags = fakeRemote<undefined>('GET', '/rpc/tags')
        const getUser = fakeRemote<undefined>('GET', '/rpc/user')
        const store = cacheStoreSlot.fallback!

        await cache(getPosts, { tags: 'dashboard' })()
        await cache(getTags, { tags: 'dashboard' })()
        await cache(getUser, { tags: 'profile' })()
        expect(store.entries.size).toBe(3)

        cache.invalidate({ tags: 'dashboard' })

        expect(Array.from(store.entries.keys())).toEqual(['GET /rpc/user'])
    })

    test('{ tags } notifies subscribers of every affected key', async () => {
        const getPosts = fakeRemote<undefined>('GET', '/rpc/posts')
        const store = cacheStoreSlot.fallback!
        await cache(getPosts, { tags: 'dashboard' })()

        let notified: CacheInvalidation | undefined
        store.events.addEventListener('invalidate', (event) => {
            notified = (event as CustomEvent<CacheInvalidation>).detail
        })

        cache.invalidate({ tags: 'dashboard' })
        expect(notified?.has('GET /rpc/posts')).toBe(true)
    })

    test('an unknown tag is a no-op without dispatching an event', async () => {
        const getPosts = fakeRemote<undefined>('GET', '/rpc/posts')
        const store = cacheStoreSlot.fallback!
        await cache(getPosts, { tags: 'dashboard' })()

        let dispatched = false
        store.events.addEventListener('invalidate', () => {
            dispatched = true
        })

        cache.invalidate({ tags: 'nonexistent' })
        expect(dispatched).toBe(false)
        expect(store.entries.size).toBe(1)
    })

    test('a re-read with tags tags an entry that was created without one', async () => {
        const getPosts = fakeRemote<undefined>('GET', '/rpc/posts')
        const store = cacheStoreSlot.fallback!

        await cache(getPosts)()
        expect(store.entries.get('GET /rpc/posts')?.tags).toBeUndefined()

        await cache(getPosts, { tags: 'dashboard' })()
        expect(store.entries.get('GET /rpc/posts')?.tags?.has('dashboard')).toBe(true)

        cache.invalidate({ tags: 'dashboard' })
        expect(store.entries.size).toBe(0)
    })

    test('an array of tags makes an entry reachable from any of its groups', async () => {
        const getGrid = fakeRemote<undefined>('GET', '/rpc/grid')
        const store = cacheStoreSlot.fallback!

        await cache(getGrid, { tags: ['media', 'sources'] })()
        cache.invalidate({ tags: 'sources' })
        expect(store.entries.size).toBe(0)

        await cache(getGrid, { tags: ['media', 'sources'] })()
        cache.invalidate({ tags: 'media' })
        expect(store.entries.size).toBe(0)
    })

    test('an array-of-tags selector drops entries matching any requested tag', async () => {
        const getPosts = fakeRemote<undefined>('GET', '/rpc/posts')
        const getTags = fakeRemote<undefined>('GET', '/rpc/tags')
        const getUser = fakeRemote<undefined>('GET', '/rpc/user')
        const store = cacheStoreSlot.fallback!

        await cache(getPosts, { tags: 'media' })()
        await cache(getTags, { tags: 'sources' })()
        await cache(getUser, { tags: 'profile' })()

        cache.invalidate({ tags: ['media', 'sources'] })
        expect(Array.from(store.entries.keys())).toEqual(['GET /rpc/user'])
    })

    test('a re-read merges new tags into an entry rather than replacing them', async () => {
        const getGrid = fakeRemote<undefined>('GET', '/rpc/grid')
        const store = cacheStoreSlot.fallback!

        await cache(getGrid, { tags: 'media' })()
        await cache(getGrid, { tags: 'sources' })()
        expect(store.entries.get('GET /rpc/grid')?.tags).toEqual(new Set(['media', 'sources']))

        cache.invalidate({ tags: 'media' })
        expect(store.entries.size).toBe(0)
    })
})
