import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { decodeResponse } from '../src/lib/shared/decodeResponse.ts'
import { REMOTE_FUNCTION } from '../src/lib/shared/REMOTE_FUNCTION.ts'
import { remoteMetaStore } from '../src/lib/shared/remoteMetaStore.ts'
import type { RawRemoteFunction } from '../src/lib/shared/types/RawRemoteFunction.ts'
import type { RemoteFunction } from '../src/lib/shared/types/RemoteFunction.ts'
import { reconnectable } from './support/reconnectable.ts'
import { settle } from './support/settle.ts'
import { useBrowserWindow } from './support/useBrowserWindow.ts'

type List = { items: number[] }

/*
A decoded remote (carries `.raw`, so cache() takes the decode-on-the-way-out
path and the warm value path patch writes to) whose body is a closure, with an
invocation counter so a test can prove a patch folded the delta in rather than
refetching. Meta is recorded per call so cache() accepts it.
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
context.patch folds an authoritative frame delta straight onto the cached value
(ADR-0007): no refetch, served on the warm read path, and the patched key is
covered so a transport gap resyncs by full invalidate.
*/
describe('cache.on context.patch', () => {
    useBrowserWindow()
    let store = createCacheStore()
    beforeEach(() => {
        store = createCacheStore()
        cacheStoreSlot.resolver = () => store
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
    })

    test('a frame delta folds onto the cached value with no refetch', async () => {
        const { subscribable, connections } = reconnectable<number>('patch-fold')
        const { fn, calls } = countingRemote('/rpc/patch-fold', () => ({ items: [1] }))
        await cache(fn)({ id: 1 })
        expect(calls()).toBe(1)

        const dispose = cache.on(subscribable, async (frame, { patch }) => {
            await patch(fn, (current: List) => ({ items: [...current.items, frame] }), { id: 1 })
        })
        connections[0].push(2)
        await settle()

        /* Warm read returns the folded value; the remote was never called again. */
        expect(await cache(fn)({ id: 1 })).toEqual({ items: [1, 2] })
        expect(calls()).toBe(1)
        dispose()
    })

    test('the patched key is covered: a transport gap resyncs by full invalidate', async () => {
        const { subscribable, connections } = reconnectable<number>('patch-cover')
        const { fn } = countingRemote('/rpc/patch-cover', () => ({ items: [1] }))
        await cache(fn)({ id: 1 })

        const dispose = cache.on(subscribable, async (frame, { patch }) => {
            await patch(fn, (current: List) => ({ items: [...current.items, frame] }), { id: 1 })
        })
        connections[0].push(2)
        await settle()
        /* Patched in place, not dropped. */
        expect(store.entries.size).toBe(1)

        connections[0].disconnect()
        await settle()
        /* Gap re-invalidated the patched key — next read would refetch. */
        expect(store.entries.size).toBe(0)
        dispose()
    })

    test('returns the touched keys; an unmatched selector is a no-op', async () => {
        const { subscribable, connections } = reconnectable<number>('patch-keys')
        const matched = countingRemote('/rpc/patch-keys', () => ({ items: [1] }))
        const absent = countingRemote('/rpc/patch-absent', () => ({ items: [9] }))
        await cache(matched.fn)({ id: 1 })

        const touched: string[][] = []
        const dispose = cache.on(subscribable, async (frame, { patch }) => {
            touched.push(
                await patch(matched.fn, (c: List) => ({ items: [...c.items, frame] }), {
                    id: 1,
                }),
            )
            touched.push(await patch(absent.fn, (c: List) => c, { id: 1 }))
        })
        connections[0].push(2)
        await settle()

        expect(touched).toEqual([['GET /rpc/patch-keys?id=1'], []])
        dispose()
    })
})
