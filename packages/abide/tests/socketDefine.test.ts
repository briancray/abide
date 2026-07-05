import { describe, expect, test } from 'bun:test'
import { defineSocket } from '../src/lib/server/sockets/defineSocket.ts'

/* defineSocket's in-process surface: broadcast (the taught alias of publish) delivers to
   live subscribers, retention defaults to 1 (a late tail() reader seeds the last frame),
   and bare iteration stays live-only so a real-time reaction never re-processes the tail. */
describe('defineSocket — broadcast + default tail', () => {
    test('broadcast delivers to a live subscriber (alias of publish)', async () => {
        const sock = defineSocket<string>('t-broadcast')
        const iterator = sock[Symbol.asyncIterator]()
        sock.broadcast('hello')
        const next = await iterator.next()
        expect(next.value).toBe('hello')
    })

    test('retention defaults to 1: a later tail() reader replays the last frame', async () => {
        const sock = defineSocket<string>('t-tail-default')
        sock.broadcast('first')
        sock.broadcast('second')
        const iterator = sock.tail()[Symbol.asyncIterator]()
        const next = await iterator.next()
        /* Only the last frame is retained (default tail 1), not 'first'. */
        expect(next.value).toBe('second')
    })

    test('bare iteration replays nothing (live-only, unaffected by retention)', async () => {
        const sock = defineSocket<string>('t-bare-live')
        sock.broadcast('old')
        const iterator = sock[Symbol.asyncIterator]()
        sock.broadcast('new')
        const next = await iterator.next()
        expect(next.value).toBe('new')
    })

    test('tail: 0 opts out of retention entirely', async () => {
        const sock = defineSocket<string>('t-no-tail', { tail: 0 })
        sock.broadcast('gone')
        const iterator = sock.tail()[Symbol.asyncIterator]()
        /* No retained frames → the tail reader goes straight live; a fresh broadcast lands. */
        sock.broadcast('live')
        const next = await iterator.next()
        expect(next.value).toBe('live')
    })
})
