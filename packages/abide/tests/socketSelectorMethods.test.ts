import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { defineSocket } from '../src/lib/server/sockets/defineSocket.ts'
import { buildSocketOverChannel } from '../src/lib/shared/buildSocketOverChannel.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { done } from '../src/lib/shared/done.ts'
import { pending } from '../src/lib/shared/pending.ts'
import { refreshing } from '../src/lib/shared/refreshing.ts'
import { watch } from '../src/lib/ui/watch.ts'
import { reconnectable } from './support/reconnectable.ts'
import { settle } from './support/settle.ts'
import { useBrowserWindow } from './support/useBrowserWindow.ts'

/*
The socket instance probes are the globals pre-bound to the socket selector:
`socket.pending()` ≡ `pending(socket)`, likewise refreshing / done, and
`socket.error()` reads the stream's terminal error (instance-only, no bare global).
A production Socket keys the tail registry by `.name`, so building a socket named
the same as a consumed stream lets the instance methods read that stream's entry —
the exact delegation the attach guarantees. `resolveChannel` throws because these
tests never subscribe/publish through the socket itself; only its probe methods run.
*/
describe('socket instance selector methods', () => {
    useBrowserWindow()
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
    })

    const socketOf = <T>(name: string) =>
        buildSocketOverChannel<T>(name, () => {
            throw new Error('channel not used in probe tests')
        })

    test('socket.pending() mirrors pending(socket) and flips false on the first frame', async () => {
        const socket = socketOf<string>('sock-pending')
        const { subscribable, connections } = reconnectable<string>('sock-pending')
        const stop = watch(subscribable, () => undefined)
        await settle()
        expect(socket.pending()).toBe(true)
        expect(socket.pending()).toBe(pending(socket))

        connections[0].push('a')
        await settle()
        expect(socket.pending()).toBe(false)
        expect(socket.pending()).toBe(pending(socket))
        stop()
    })

    test('socket.refreshing() mirrors refreshing(socket) across a reconnect gap', async () => {
        const socket = socketOf<string>('sock-refreshing')
        const { subscribable, connections } = reconnectable<string>('sock-refreshing')
        const stop = watch(subscribable, () => undefined)
        await settle()

        connections[0].push('a')
        await settle()
        expect(socket.refreshing()).toBe(false)

        connections[0].disconnect()
        await settle()
        /* A value seen before the gap → refreshing while a fresh connection reopens. */
        expect(socket.refreshing()).toBe(true)
        expect(socket.refreshing()).toBe(refreshing(socket))

        connections[1].push('b')
        await settle()
        expect(socket.refreshing()).toBe(false)
        stop()
    })

    test('socket.done() mirrors done(socket) when the stream ends cleanly', async () => {
        const socket = socketOf<string>('sock-done')
        const { subscribable, connections } = reconnectable<string>('sock-done')
        const stop = watch(subscribable, () => undefined)
        await settle()
        expect(socket.done()).toBe(false)

        connections[0].push('a')
        connections[0].end()
        await settle()
        expect(socket.done()).toBe(true)
        expect(socket.done()).toBe(done(socket))
        stop()
    })

    test('socket.error() surfaces the stream terminal error', async () => {
        const socket = socketOf<string>('sock-error')
        const { subscribable, connections } = reconnectable<string>('sock-error')
        const stop = watch(subscribable, () => undefined)
        await settle()
        expect(socket.error()).toBeUndefined()

        /* The push iterator re-materialises the terminal error from its message, so identity is
           not preserved end-to-end — assert on the surfaced message. */
        connections[0].error('stream blew up')
        await settle()
        expect(socket.error()?.message).toBe('stream blew up')
        stop()
    })

    test('a server socket carries the same probe shape, reading server fallbacks', () => {
        const socket = defineSocket<string>('sock-server')
        expect(typeof socket.pending).toBe('function')
        expect(typeof socket.refreshing).toBe('function')
        expect(typeof socket.done).toBe('function')
        expect(typeof socket.error).toBe('function')
        /* No tail prober on the server: a named stream has no value yet, nothing reconnecting,
           not done, no error — matching what the globals report there. */
        expect(socket.pending()).toBe(true)
        expect(socket.refreshing()).toBe(false)
        expect(socket.done()).toBe(false)
        expect(socket.error()).toBeUndefined()
    })
})
