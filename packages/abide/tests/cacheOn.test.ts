import { afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { REMOTE_FUNCTION } from '../src/lib/shared/REMOTE_FUNCTION.ts'
import { remoteMetaStore } from '../src/lib/shared/remoteMetaStore.ts'
import type { RawRemoteFunction } from '../src/lib/shared/types/RawRemoteFunction.ts'
import { reconnectable } from './support/reconnectable.ts'
import { settle } from './support/settle.ts'
import { useBrowserWindow } from './support/useBrowserWindow.ts'

/* A raw remote resolving immediately; key derivation happens in cache(). */
function getMedia(url: string): RawRemoteFunction<{ id: number }> {
    const fn = () => {
        const request = new Request(`https://test.local${url}`, { method: 'GET' })
        const promise = Promise.resolve(
            new Response(JSON.stringify({ ok: true }), {
                headers: { 'content-type': 'application/json' },
            }),
        )
        remoteMetaStore.set(promise, () => request)
        return promise
    }
    return Object.assign(fn, { method: 'GET', url, [REMOTE_FUNCTION]: true }) as RawRemoteFunction<{
        id: number
    }>
}

/*
cache.on owns the frame→invalidation wiring apps used to hand-roll in
$effects: sequential edge-triggered delivery, a binding-scoped invalidate
whose calls form the coverage set, and conservative coverage replay after a
transport gap (a missed frame is a missed invalidation).
*/
describe('cache.on', () => {
    useBrowserWindow()
    let store = createCacheStore()
    beforeEach(() => {
        store = createCacheStore()
        cacheStoreSlot.resolver = () => store
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
    })

    test('frames drive the handler; scoped invalidate drops the targeted entry', async () => {
        const { subscribable, connections } = reconnectable<{ id: number }>('on-basic')
        const get = getMedia('/rpc/on-basic')
        await cache(get, { id: 1 })
        await cache(get, { id: 2 })

        const dispose = cache.on(subscribable, (frame, { invalidate }) => {
            invalidate(get, { id: frame.id })
        })
        connections[0].push({ id: 1 })
        await settle()

        expect([...store.entries.keys()]).toEqual(['GET /rpc/on-basic?id=2'])
        dispose()
    })

    test('delivery is sequential: the next frame waits for the previous handler', async () => {
        const { subscribable, connections } = reconnectable<string>('on-sequential')
        let release: () => void = () => undefined
        const order: string[] = []
        const dispose = cache.on(subscribable, async (frame) => {
            order.push(`start ${frame}`)
            await new Promise<void>((resolve) => {
                release = resolve
            })
            order.push(`end ${frame}`)
        })
        connections[0].push('a')
        connections[0].push('b')
        await settle()
        expect(order).toEqual(['start a'])

        release()
        await settle()
        expect(order).toEqual(['start a', 'end a', 'start b'])
        release()
        dispose()
    })

    test('a transport loss replays the coverage set and reopens the source', async () => {
        const { subscribable, connections } = reconnectable<{ id: number }>('on-replay')
        const get = getMedia('/rpc/on-replay')
        await cache(get, { id: 7 })

        const dispose = cache.on(subscribable, (frame, { invalidate }) => {
            invalidate(get, { id: frame.id })
        })
        connections[0].push({ id: 7 })
        await settle()
        expect(store.entries.size).toBe(0)

        /* Re-warm, then drop the transport: no frame arrives, yet the gap must stale prior coverage. */
        await cache(get, { id: 7 })
        expect(store.entries.size).toBe(1)
        connections[0].disconnect()
        await settle()

        expect(store.entries.size).toBe(0)
        expect(connections).toHaveLength(2)
        dispose()
    })

    test('dispose aborts the signal and stops delivery', async () => {
        const { subscribable, connections } = reconnectable<string>('on-dispose')
        const frames: string[] = []
        let seenSignal: AbortSignal | undefined
        const dispose = cache.on(subscribable, (frame, { signal }) => {
            frames.push(frame)
            seenSignal = signal
        })
        connections[0].push('a')
        await settle()
        expect(frames).toEqual(['a'])
        expect(seenSignal?.aborted).toBe(false)

        dispose()
        connections[0].push('b')
        await settle()
        expect(frames).toEqual(['a'])
        expect(seenSignal?.aborted).toBe(true)
    })

    test('a handler throw is logged and the binding lives on', async () => {
        const { subscribable, connections } = reconnectable<string>('on-throw')
        const logged: Mock<typeof console.error> = spyOn(console, 'error').mockImplementation(
            () => undefined,
        )
        const frames: string[] = []
        const dispose = cache.on(subscribable, (frame) => {
            frames.push(frame)
            if (frame === 'bad') {
                throw new Error('frame exploded')
            }
        })
        connections[0].push('bad')
        connections[0].push('good')
        await settle()

        expect(frames).toEqual(['bad', 'good'])
        expect(logged).toHaveBeenCalledTimes(1)
        logged.mockRestore()
        dispose()
    })
})

/* No window: SSR can't hold a stream across the request boundary, so the binding is inert. */
describe('cache.on on the server', () => {
    test('returns an inert dispose without opening the source', () => {
        const { subscribable, connections } = reconnectable<string>('on-server')
        const dispose = cache.on(subscribable, () => undefined)
        expect(connections).toHaveLength(0)
        expect(dispose()).toBeUndefined()
    })
})
