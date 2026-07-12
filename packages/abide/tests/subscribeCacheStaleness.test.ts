import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { createPushIterator, type PushIterator } from '../src/lib/shared/createPushIterator.ts'
import { createRemoteFunction } from '../src/lib/shared/createRemoteFunction.ts'
import { keyForRemoteCall } from '../src/lib/shared/keyForRemoteCall.ts'
import type { CacheStalenessFrame } from '../src/lib/shared/types/CacheStalenessFrame.ts'
import type { Socket } from '../src/lib/shared/types/Socket.ts'
import { subscribeCacheStaleness } from '../src/lib/ui/subscribeCacheStaleness.ts'
import { track } from './support/reactiveScope.ts'
import { settle } from './support/settle.ts'
import { useBrowserWindow } from './support/useBrowserWindow.ts'

/* A minimal live Socket over a push iterator — the injectable seam the consumer iterates.
   Only bare iteration is exercised, so the other Socket members are inert stubs. */
function frameSocket(): {
    socket: Socket<CacheStalenessFrame>
    iter: PushIterator<CacheStalenessFrame>
} {
    const iter = createPushIterator<CacheStalenessFrame>()
    const socket = {
        [Symbol.asyncIterator]: () => iter,
    } as unknown as Socket<CacheStalenessFrame>
    return { socket, iter }
}

describe('subscribeCacheStaleness (client live-only consumer)', () => {
    useBrowserWindow()
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
    })

    test('an invalidate frame drops the matching entry so the next read reloads', async () => {
        let n = 0
        async function loadN() {
            n += 1
            return n
        }
        expect(await cache(loadN)).toBe(1)
        expect(await cache(loadN)).toBe(1) // warm hit

        const { socket, iter } = frameSocket()
        const dispose = subscribeCacheStaleness(socket)

        /* The producer key is the entry key the read stored — the wire `key` mode re-matches it
           by equality (the same string), just as a cross-client remote key would. */
        const key = cacheStoreSlot.fallback?.entries.keys().next().value as string
        const frame: CacheStalenessFrame = { op: 'invalidate', mode: 'key', match: key, tags: [] }
        iter.push(frame)
        await settle()

        expect(cacheStoreSlot.fallback?.entries.has(key)).toBe(false)
        expect(await cache(loadN)).toBe(2) // dropped → reloaded
        dispose()
    })

    test('a refresh frame refetches a live-read remote entry, keeping it retained', async () => {
        let n = 0
        const getN = createRemoteFunction<undefined, { n: number }>({
            method: 'GET',
            url: '/rpc/staleness-refresh',
            clients: { browser: true, mcp: false, cli: false },
            buildRequest: () => new Request('http://x/rpc/staleness-refresh'),
            invoke: async () => {
                n += 1
                return new Response(JSON.stringify({ n }), {
                    headers: { 'content-type': 'application/json' },
                })
            },
        })
        /* A live tracking reader holds the value — refresh refetches-and-swaps for a key with a
           reader (mirrors refresh() semantics). */
        const tracked = track(() => getN())
        await settle()
        expect(n).toBe(1)

        const { socket, iter } = frameSocket()
        const dispose = subscribeCacheStaleness(socket)

        const frame: CacheStalenessFrame = {
            op: 'refresh',
            mode: 'prefix',
            match: keyForRemoteCall('GET', '/rpc/staleness-refresh', undefined),
            tags: [],
        }
        iter.push(frame)
        await settle()

        expect(n).toBe(2)
        tracked.stop()
        dispose()
    })

    test('is an inert no-op on the server (no window)', () => {
        delete (globalThis as { window?: unknown }).window
        const { socket } = frameSocket()
        const dispose = subscribeCacheStaleness(socket)
        expect(typeof dispose).toBe('function')
        dispose()
        ;(globalThis as { window?: unknown }).window = {}
    })
})
