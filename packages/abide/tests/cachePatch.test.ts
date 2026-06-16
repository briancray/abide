import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { decodeResponse } from '../src/lib/shared/decodeResponse.ts'
import { REMOTE_FUNCTION } from '../src/lib/shared/REMOTE_FUNCTION.ts'
import { remoteMetaStore } from '../src/lib/shared/remoteMetaStore.ts'
import type { RawRemoteFunction } from '../src/lib/shared/types/RawRemoteFunction.ts'
import type { RemoteFunction } from '../src/lib/shared/types/RemoteFunction.ts'
import { settle } from './support/settle.ts'
import { useBrowserWindow } from './support/useBrowserWindow.ts'

type List = { items: number[] }

/*
A decoded remote (carries `.raw`, so cache() takes the warm-value path patch
writes to) whose body is read live each call — so a refetch after an invalidate
observes server-side mutations — with an invocation counter to prove whether a
read folded the prediction in or refetched.
*/
function countingRemote(
    url: string,
    body: () => List,
): { fn: RemoteFunction<{ id: number }, List>; calls: () => number } {
    let calls = 0
    const rawCall = () => {
        calls += 1
        const request = new Request(`https://test.local${url}`, { method: 'GET' })
        const promise = Promise.resolve(
            new Response(JSON.stringify(body()), {
                headers: { 'content-type': 'application/json' },
            }),
        )
        remoteMetaStore.set(promise, () => request)
        return promise
    }
    const raw = Object.assign(rawCall, {
        method: 'GET',
        url,
        [REMOTE_FUNCTION]: true,
    }) as RawRemoteFunction<{ id: number }>
    const fn = Object.assign((args: { id: number }) => raw(args).then(decodeResponse), {
        method: 'GET',
        url,
        raw,
        [REMOTE_FUNCTION]: true,
    }) as unknown as RemoteFunction<{ id: number }, List>
    return { fn, calls: () => calls }
}

/*
cache.patch is the optimistic write (ADR-0009): predict now, run the call, then
reconcile — invalidate to server truth on resolve, roll back on reject. The
returned promise is transparent over the call.
*/
describe('cache.patch (optimistic)', () => {
    useBrowserWindow()
    let store = createCacheStore()
    beforeEach(() => {
        store = createCacheStore()
        cacheStoreSlot.resolver = () => store
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
    })

    test('applies the prediction immediately, then reconciles to server truth on resolve', async () => {
        let server: List = { items: [1] }
        const { fn, calls } = countingRemote('/rpc/opt', () => server)
        expect(await cache(fn)({ id: 1 })).toEqual({ items: [1] })
        expect(calls()).toBe(1)

        /* A mutation we control: hold it open to observe the in-flight prediction. */
        let release: () => void = () => undefined
        const call = new Promise<{ id: number }>((resolve) => {
            release = () => resolve({ id: 2 })
        })
        const done = cache.patch(fn, (current: List) => ({ items: [...current.items, 2] }), call, {
            id: 1,
        })
        await settle()
        /* Prediction is warm and visible before the call resolves — no refetch. */
        expect(await cache(fn)({ id: 1 })).toEqual({ items: [1, 2] })
        expect(calls()).toBe(1)

        /* The server applied the mutation; resolving invalidates → refetch truth. */
        server = { items: [1, 2] }
        release()
        await done
        await settle()
        expect(await cache(fn)({ id: 1 })).toEqual({ items: [1, 2] })
        expect(calls()).toBe(2)
    })

    test('rolls back the prediction and rejects with the call error', async () => {
        const { fn, calls } = countingRemote('/rpc/opt-fail', () => ({ items: [1] }))
        await cache(fn)({ id: 1 })
        expect(calls()).toBe(1)

        const done = cache.patch(
            fn,
            (current: List) => ({ items: [...current.items, 2] }),
            Promise.reject(new Error('nope')),
            { id: 1 },
        )
        await expect(done).rejects.toThrow('nope')
        await settle()
        /* Reverted to the pre-prediction value, no refetch triggered. */
        expect(await cache(fn)({ id: 1 })).toEqual({ items: [1] })
        expect(calls()).toBe(1)
    })

    test('resolves to the call result (transparent over call)', async () => {
        const { fn } = countingRemote('/rpc/opt-return', () => ({ items: [1] }))
        await cache(fn)({ id: 1 })

        const created = { id: 99 }
        const result = await cache.patch(
            fn,
            (current: List) => ({ items: [...current.items, 99] }),
            Promise.resolve(created),
            { id: 1 },
        )
        expect(result).toBe(created)
    })
})
