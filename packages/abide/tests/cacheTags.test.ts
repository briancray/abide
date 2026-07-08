import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { producerKey } from '../src/lib/shared/producerKey.ts'
import { REMOTE_FUNCTION } from '../src/lib/shared/REMOTE_FUNCTION.ts'
import { remoteMetaStore } from '../src/lib/shared/remoteMetaStore.ts'
import { sharedCacheStoreSlot } from '../src/lib/shared/sharedCacheStoreSlot.ts'
import type { CacheInvalidation } from '../src/lib/shared/types/CacheInvalidation.ts'
import type { CachePolicy } from '../src/lib/shared/types/CachePolicy.ts'
import type { HttpMethod } from '../src/lib/shared/types/HttpMethod.ts'
import type { RawRemoteFunction } from '../src/lib/shared/types/RawRemoteFunction.ts'

/* Minimal raw remote function that records request meta so cache() accepts it. Endpoint
   cache policy (ADR-0020) rides on the definition, so tags are stamped as `.cache` here —
   there is no call-site tags option for a remote any more. */
function fakeRemote<Args>(
    method: HttpMethod,
    url: string,
    cachePolicy?: CachePolicy<Args>,
): RawRemoteFunction<Args> {
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
    Object.assign(fn, { method, url, cache: cachePolicy, [REMOTE_FUNCTION]: true })
    return fn
}

describe('cache.invalidate selector', () => {
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
        /* A distinct shared-store resolver: sharedCacheStore() degrades to
           activeCacheStore() when unwired, which would otherwise alias
           cacheStoreSlot.fallback and falsely trip cache.ts's
           `store !== sharedCacheStore()` request-scope guard, evicting these
           ttl=0 entries before the test can inspect them. */
        sharedCacheStoreSlot.resolver = () => createCacheStore()
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
        sharedCacheStoreSlot.resolver = undefined
    })

    test('{ tags } drops every entry carrying the tag, leaving others', async () => {
        const getPosts = fakeRemote<undefined>('GET', '/rpc/posts', { tags: ['dashboard'] })
        const getTags = fakeRemote<undefined>('GET', '/rpc/tags', { tags: ['dashboard'] })
        const getUser = fakeRemote<undefined>('GET', '/rpc/user', { tags: ['profile'] })
        const store = cacheStoreSlot.fallback!

        await cache(getPosts)
        await cache(getTags)
        await cache(getUser)
        expect(store.entries.size).toBe(3)

        cache.invalidate({ tags: ['dashboard'] })

        expect(Array.from(store.entries.keys())).toEqual(['GET /rpc/user'])
    })

    test('{ tags } notifies subscribers of every affected key', async () => {
        const getPosts = fakeRemote<undefined>('GET', '/rpc/posts', { tags: ['dashboard'] })
        const store = cacheStoreSlot.fallback!
        await cache(getPosts)

        let notified: CacheInvalidation | undefined
        store.events.addEventListener('invalidate', (event) => {
            notified = (event as CustomEvent<CacheInvalidation>).detail
        })

        cache.invalidate({ tags: ['dashboard'] })
        expect(notified?.has('GET /rpc/posts')).toBe(true)
    })

    test('an unknown tag is a no-op without dispatching an event', async () => {
        const getPosts = fakeRemote<undefined>('GET', '/rpc/posts', { tags: ['dashboard'] })
        const store = cacheStoreSlot.fallback!
        await cache(getPosts)

        let dispatched = false
        store.events.addEventListener('invalidate', () => {
            dispatched = true
        })

        cache.invalidate({ tags: ['nonexistent'] })
        expect(dispatched).toBe(false)
        expect(store.entries.size).toBe(1)
    })

    test('a re-read with tags tags a producer entry that was created without one', async () => {
        /* Producers keep call-site cache options (ADR-0020 only strips them from remotes),
           so they still exercise the tag-merge path: a first tagless read, then a tagging
           re-read that arms the same entry for invalidation. */
        const loadPosts = () => Promise.resolve({ ok: true })
        const store = cacheStoreSlot.fallback!
        const key = producerKey(loadPosts, undefined)

        await cache(loadPosts)
        expect(store.entries.get(key)?.tags).toBeUndefined()

        await cache(loadPosts, undefined, { tags: ['dashboard'] })
        expect(store.entries.get(key)?.tags?.has('dashboard')).toBe(true)

        cache.invalidate({ tags: ['dashboard'] })
        expect(store.entries.size).toBe(0)
    })

    test('an array of tags makes an entry reachable from any of its groups', async () => {
        const getGrid = fakeRemote<undefined>('GET', '/rpc/grid', { tags: ['media', 'sources'] })
        const store = cacheStoreSlot.fallback!

        await cache(getGrid)
        cache.invalidate({ tags: ['sources'] })
        expect(store.entries.size).toBe(0)

        await cache(getGrid)
        cache.invalidate({ tags: ['media'] })
        expect(store.entries.size).toBe(0)
    })

    test('an array-of-tags selector drops entries matching any requested tag', async () => {
        const getPosts = fakeRemote<undefined>('GET', '/rpc/posts', { tags: ['media'] })
        const getTags = fakeRemote<undefined>('GET', '/rpc/tags', { tags: ['sources'] })
        const getUser = fakeRemote<undefined>('GET', '/rpc/user', { tags: ['profile'] })
        const store = cacheStoreSlot.fallback!

        await cache(getPosts)
        await cache(getTags)
        await cache(getUser)

        cache.invalidate({ tags: ['media', 'sources'] })
        expect(Array.from(store.entries.keys())).toEqual(['GET /rpc/user'])
    })

    test('a re-read merges new tags into a producer entry rather than replacing them', async () => {
        /* Two producer reads contribute distinct call-site tag sets to one entry — the
           tagEntry merge (not replace) still holds. */
        const loadGrid = () => Promise.resolve({ ok: true })
        const store = cacheStoreSlot.fallback!
        const key = producerKey(loadGrid, undefined)

        await cache(loadGrid, undefined, { tags: ['media'] })
        await cache(loadGrid, undefined, { tags: ['sources'] })
        expect(store.entries.get(key)?.tags).toEqual(new Set(['media', 'sources']))

        cache.invalidate({ tags: ['media'] })
        expect(store.entries.size).toBe(0)
    })
})
