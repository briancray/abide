import { describe, expect, test } from 'bun:test'
import { defineSocket } from '../src/lib/server/sockets/defineSocket.ts'
import { buildSocketOverChannel } from '../src/lib/shared/buildSocketOverChannel.ts'
import { peek } from '../src/lib/shared/peek.ts'
import type { SocketChannel } from '../src/lib/shared/types/SocketChannel.ts'
import type { SocketSubCallbacks } from '../src/lib/shared/types/SocketSubCallbacks.ts'

/* defineSocket's in-process surface: publish delivers to live subscribers, retention
   defaults to 1 (a late tail() reader seeds the last frame), and bare iteration stays
   live-only so a real-time reaction never re-processes the tail. */
describe('defineSocket — publish + default tail', () => {
    test('publish delivers to a live subscriber', async () => {
        const sock = defineSocket<string>('t-publish')
        const iterator = sock[Symbol.asyncIterator]()
        sock.publish('hello')
        const next = await iterator.next()
        expect(next.value).toBe('hello')
    })

    test('retention defaults to 1: a later tail() reader replays the last frame', async () => {
        const sock = defineSocket<string>('t-tail-default')
        sock.publish('first')
        sock.publish('second')
        const iterator = sock.tail()[Symbol.asyncIterator]()
        const next = await iterator.next()
        /* Only the last frame is retained (default tail 1), not 'first'. */
        expect(next.value).toBe('second')
    })

    test('bare iteration replays nothing (live-only, unaffected by retention)', async () => {
        const sock = defineSocket<string>('t-bare-live')
        sock.publish('old')
        const iterator = sock[Symbol.asyncIterator]()
        sock.publish('new')
        const next = await iterator.next()
        expect(next.value).toBe('new')
    })

    test('tail: 0 opts out of retention entirely', async () => {
        const sock = defineSocket<string>('t-no-tail', { tail: 0 })
        sock.publish('gone')
        const iterator = sock.tail()[Symbol.asyncIterator]()
        /* No retained frames → the tail reader goes straight live; a fresh publish lands. */
        sock.publish('live')
        const next = await iterator.next()
        expect(next.value).toBe('live')
    })

    test('server peek() returns the latest retained frame; refresh() is a no-op', () => {
        const sock = defineSocket<string>('t-peek')
        expect(sock.peek()).toBeUndefined()
        sock.publish('a')
        sock.publish('b')
        expect(sock.peek()).toBe('b')
        sock.refresh() // no-op on the server, must not throw or clear
        expect(sock.peek()).toBe('b')
    })

    test('peek(socket) routes to the socket .peek()', () => {
        const sock = defineSocket<string>('t-peek-global')
        sock.publish('x')
        expect(peek(sock)).toBe('x')
    })
})

/* The client proxy tracks the latest frame across iterators for peek(). */
describe('buildSocketOverChannel — peek', () => {
    test('peek() reflects the latest frame delivered over the channel', () => {
        let deliver: ((message: unknown) => void) | undefined
        const channel: SocketChannel = {
            subscribe: (_sub, _socket, _replay, callbacks: SocketSubCallbacks) => {
                deliver = callbacks.onMessage
            },
            unsubscribe: () => undefined,
            publish: () => undefined,
        }
        const sock = buildSocketOverChannel<string>('t-client', () => channel)
        expect(sock.peek()).toBeUndefined()
        /* Open an iterator so the channel subscription (and its onMessage) is live. */
        sock[Symbol.asyncIterator]()
        deliver?.('frame-1')
        deliver?.('frame-2')
        expect(sock.peek()).toBe('frame-2')
        expect(peek(sock)).toBe('frame-2')
    })
})
