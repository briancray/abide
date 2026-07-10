import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { defineSocket } from '../src/lib/server/sockets/defineSocket.ts'
import { buildSocketOverChannel } from '../src/lib/shared/buildSocketOverChannel.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { createRemoteFunction } from '../src/lib/shared/createRemoteFunction.ts'
import { peek } from '../src/lib/shared/peek.ts'
import type { SocketChannel } from '../src/lib/shared/types/SocketChannel.ts'
import type { SocketSubCallbacks } from '../src/lib/shared/types/SocketSubCallbacks.ts'
import { remoteProxy } from '../src/lib/ui/remoteProxy.ts'
import { socketProxy } from '../src/lib/ui/socketProxy.ts'
import { watch } from '../src/lib/ui/watch.ts'
import { settle } from './support/settle.ts'

const globals = globalThis as Record<string, unknown>
const realFetch = globalThis.fetch
const BROWSER_ONLY = { browser: true, mcp: false, cli: false }

const tick = () => new Promise((resolve) => setTimeout(resolve, 10))

/* `.watch` is the instance form of the global `watch` reaction: `socket.watch(h)` ≡
   `watch(socket, h)`, `fn.watch(h)` / `fn.watch(args, h)` ≡ `watch(fn, …)`. The real method is
   client-attached (socketProxy / remoteProxy) so the ui-only `watch` never rides into a server
   bundle; every server / shared-builder shape carries an inert no-op instead, so an author
   `.watch(…)` that survives the SSR effect-strip (member calls are left intact) is safe. */
describe('rpc .watch — client', () => {
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
        globals.window = { location: { href: 'http://x/' } }
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
        globalThis.fetch = realFetch
        delete globals.window
    })

    test('fn.watch(handler) runs the smart read and mirrors watch(fn, handler)', async () => {
        globalThis.fetch = (async () =>
            new Response(JSON.stringify(['a']), {
                headers: { 'content-type': 'application/json' },
            })) as unknown as typeof fetch
        const getList = remoteProxy<undefined, string[]>('GET', '/rpc/watch-inst-list')

        /* Prime the read so the cache holds the value before watching — otherwise the reactive
           read hands the handler the pending (undefined) snapshot before the fetch lands. */
        await getList()
        await settle()

        const viaMethod: unknown[] = []
        const viaGlobal: unknown[] = []
        const stopMethod = getList.watch((value) => viaMethod.push(value))
        const stopGlobal = watch(getList, (value) => viaGlobal.push(value))
        await tick()
        await settle()
        expect(viaMethod).toEqual([['a']])
        expect(viaMethod).toEqual(viaGlobal)

        /* A local patch re-runs the reactive read → the handler fires again. */
        getList.patch((list) => [...list, 'b'])
        await settle()
        expect(peek(getList)).toEqual(['a', 'b'])
        expect(viaMethod[viaMethod.length - 1]).toEqual(['a', 'b'])

        /* The disposer stops it: a later patch no longer reaches the handler. */
        stopMethod()
        const before = viaMethod.length
        getList.patch((list) => [...list, 'c'])
        await settle()
        expect(viaMethod).toHaveLength(before)
        stopGlobal()
    })
})

describe('rpc .watch — server is inert', () => {
    afterEach(() => {
        delete globals.window
    })

    test('the createRemoteFunction (defineRpc) shape carries an inert .watch no-op', () => {
        delete globals.window // server: no window
        const fn = createRemoteFunction<undefined, string[]>({
            method: 'GET',
            url: '/rpc/watch-inert',
            clients: BROWSER_ONLY,
            buildRequest: () => new Request('http://x/rpc/watch-inert'),
            invoke: async () =>
                new Response('[]', { headers: { 'content-type': 'application/json' } }),
        })
        let ran = false
        const stop = fn.watch(() => {
            ran = true
        })
        expect(typeof stop).toBe('function')
        expect(() => stop()).not.toThrow()
        expect(ran).toBe(false)
    })
})

describe('socket .watch', () => {
    afterEach(() => {
        delete globals.window
    })

    /* A fake channel that hands back the onMessage callback so a test can drive frames. */
    function fakeChannel(): { channel: SocketChannel; deliver(message: unknown): void } {
        let onMessage: ((message: unknown) => void) | undefined
        return {
            channel: {
                subscribe: (_sub, _socket, _replay, callbacks: SocketSubCallbacks) => {
                    onMessage = callbacks.onMessage
                },
                unsubscribe: () => undefined,
                publish: () => undefined,
            },
            deliver: (message) => onMessage?.(message),
        }
    }

    test('server (defineSocket) .watch is inert: a broadcast never reaches the handler', async () => {
        const sock = defineSocket<string>('t-watch-srv')
        let ran = false
        const stop = sock.watch(() => {
            ran = true
        })
        expect(typeof stop).toBe('function')
        sock.publish('a')
        sock.publish('b')
        await tick()
        expect(ran).toBe(false) // reaction is client-only; the server stub is a no-op
        expect(() => stop()).not.toThrow()
    })

    test('the shared builder default .watch is an inert no-op', () => {
        const { channel } = fakeChannel()
        const sock = buildSocketOverChannel<string>('t-watch-default', () => channel)
        let ran = false
        const stop = sock.watch(() => {
            ran = true
        })
        expect(typeof stop).toBe('function')
        expect(() => stop()).not.toThrow()
        expect(ran).toBe(false) // never subscribed — the builder ships the inert default
    })

    /* socketProxy attaches the real `socket.watch = h => watch(socket, h)`. Its live transport is
       a ws, so this drives the identical wiring over a fake channel to prove frame delivery. */
    test('client .watch delivers frames, mirroring watch(socket, handler)', async () => {
        globals.window = { location: { href: 'http://x/' } }
        const { channel, deliver } = fakeChannel()
        const sock = buildSocketOverChannel<string>('t-watch-client', () => channel)
        sock.watch = (handler) => watch(sock, handler) // exactly socketProxy's attach
        const seen: string[] = []
        const stop = sock.watch((frame) => {
            seen.push(frame)
        })
        await tick()
        deliver('a')
        deliver('b')
        await tick()
        expect(seen).toEqual(['a', 'b'])
        stop()
    })

    test('socketProxy exposes a .watch method', () => {
        expect(typeof socketProxy<string>('t-watch-proxy').watch).toBe('function')
    })
})
