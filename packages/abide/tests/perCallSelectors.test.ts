import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { pending } from '../src/lib/shared/pending.ts'
import { REMOTE_FUNCTION } from '../src/lib/shared/REMOTE_FUNCTION.ts'
import { remoteMetaStore } from '../src/lib/shared/remoteMetaStore.ts'
import type { HttpVerb } from '../src/lib/shared/types/HttpVerb.ts'
import type { RawRemoteFunction } from '../src/lib/shared/types/RawRemoteFunction.ts'

/* A raw remote that resolves immediately; key derivation happens in cache(),
   so only method+url identity matters. Records request meta so cache() accepts it. */
function argRemote(method: HttpVerb, url: string): RawRemoteFunction<{ id: number }> {
    const fn = () => {
        const request = new Request(`https://test.local${url}`, { method })
        const promise = Promise.resolve(
            new Response(JSON.stringify({ ok: true }), {
                headers: { 'content-type': 'application/json' },
            }),
        )
        remoteMetaStore.set(promise, () => request)
        return promise
    }
    return Object.assign(fn, { method, url, [REMOTE_FUNCTION]: true }) as RawRemoteFunction<{
        id: number
    }>
}

/*
fn + args is the exact-key tier of the selector grammar: the key derives
through the same encoders the read path uses (keyForRemoteCall / producerKey),
so invalidation and probes target one call's entry while sibling args
variants stay warm.
*/
describe('per-call selectors (fn, args)', () => {
    let store = createCacheStore()
    beforeEach(() => {
        store = createCacheStore()
        cacheStoreSlot.resolver = () => store
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
    })

    test("invalidate(fn, args) drops only that call's entry", async () => {
        const get = argRemote('GET', '/rpc/per-call')
        await cache(get)({ id: 1 })
        await cache(get)({ id: 2 })
        expect(store.entries.size).toBe(2)

        cache.invalidate(get, { id: 1 })
        expect([...store.entries.keys()]).toEqual(['GET /rpc/per-call?id=2'])
    })

    test('invalidate(fn) without args still drops every variant', async () => {
        const get = argRemote('GET', '/rpc/per-call-all')
        await cache(get)({ id: 1 })
        await cache(get)({ id: 2 })

        cache.invalidate(get)
        expect(store.entries.size).toBe(0)
    })

    test('pending(fn, args) reports only that flight', () => {
        const get = argRemote('GET', '/rpc/per-call-pending')
        let release: (response: Response) => void = () => undefined
        const slow = Object.assign(
            () => {
                const request = new Request('https://test.local/rpc/per-call-pending', {
                    method: 'GET',
                })
                const promise = new Promise<Response>((resolve) => {
                    release = resolve
                })
                remoteMetaStore.set(promise, () => request)
                return promise
            },
            { method: get.method, url: get.url, [REMOTE_FUNCTION]: true },
        ) as RawRemoteFunction<{ id: number }>

        cache(slow)({ id: 1 })
        expect(pending(slow, { id: 1 })).toBe(true)
        expect(pending(slow, { id: 2 })).toBe(false)
        expect(pending(slow)).toBe(true)
        release(new Response(null))
    })

    test("invalidate(producer, args) drops only that call's entry", async () => {
        function loadItem(args?: { id: number }): Promise<number> {
            return Promise.resolve(args?.id ?? 0)
        }
        await cache(loadItem)({ id: 1 })
        await cache(loadItem)({ id: 2 })
        expect(store.entries.size).toBe(2)

        cache.invalidate(loadItem, { id: 1 })
        const remaining = [...store.entries.keys()]
        expect(remaining).toHaveLength(1)
        expect(remaining[0]).toEndWith('{"id":2}')
    })
})
