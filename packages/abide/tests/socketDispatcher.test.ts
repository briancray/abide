import { describe, expect, test } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import { createSocketDispatcher } from '../src/lib/server/sockets/createSocketDispatcher.ts'
import { defineSocket } from '../src/lib/server/sockets/defineSocket.ts'
import type { SocketClientFrame } from '../src/lib/server/sockets/types/SocketClientFrame.ts'
import type { SocketServerFrame } from '../src/lib/server/sockets/types/SocketServerFrame.ts'
import { routesFor } from './support/routesFor.ts'
import { settle } from './support/settle.ts'

/*
A stand-in for Bun's ServerWebSocket capturing the frames the dispatcher
sends and the Bun topics it (un)subscribes. Steady-state live fan-out rides
the real server's native publish, so this fake covers exactly the JS the
dispatcher owns: the sub/unsub bookkeeping and retained-tail replay.
*/
function fakeSocket() {
    const sent: SocketServerFrame[] = []
    const subscribed: string[] = []
    const unsubscribed: string[] = []
    const ws = {
        readyState: WebSocket.OPEN,
        send: (data: string) => {
            sent.push(JSON.parse(data) as SocketServerFrame)
        },
        subscribe: (topic: string) => subscribed.push(topic),
        unsubscribe: (topic: string) => unsubscribed.push(topic),
    } as unknown as ServerWebSocket<unknown>
    return { ws, sent, subscribed, unsubscribed }
}

function frame(value: SocketClientFrame): string {
    return JSON.stringify(value)
}

describe('socket ws multiplex happy path', () => {
    test('sub replays the retained tail to the subscribing ws and joins the bun topic', async () => {
        const room = defineSocket<{ text: string }>('ws-room', { tail: 10 })
        room.publish({ text: 'one' })
        room.publish({ text: 'two' })
        const dispatcher = createSocketDispatcher(routesFor('ws-room'))
        const { ws, sent, subscribed } = fakeSocket()

        dispatcher.open(ws)
        dispatcher.message(ws, frame({ type: 'sub', sub: 's1', socket: 'ws-room' }))
        await settle()

        // The retained tail arrives as one per-sub batch — the replay/live demarcation.
        expect(sent).toEqual([
            { type: 'replay', sub: 's1', messages: [{ text: 'one' }, { text: 'two' }] },
        ])
        // First local sub joins the Bun topic so live fan-out reaches this ws.
        expect(subscribed).toEqual(['socket:ws-room'])
    })

    test('replay count caps how much of the retained tail a sub receives', async () => {
        const feed = defineSocket<number>('ws-capped', { tail: 10 })
        feed.publish(1)
        feed.publish(2)
        feed.publish(3)
        const dispatcher = createSocketDispatcher(routesFor('ws-capped'))
        const { ws, sent } = fakeSocket()

        dispatcher.open(ws)
        dispatcher.message(ws, frame({ type: 'sub', sub: 's1', socket: 'ws-capped', replay: 1 }))
        await settle()

        expect(sent).toEqual([{ type: 'replay', sub: 's1', messages: [3] }])
    })

    test('unsub drops the local sub, leaves the topic, and emits a terminal end', async () => {
        defineSocket('ws-leave', { tail: 0 })
        const dispatcher = createSocketDispatcher(routesFor('ws-leave'))
        const { ws, sent, unsubscribed } = fakeSocket()

        dispatcher.open(ws)
        dispatcher.message(ws, frame({ type: 'sub', sub: 's1', socket: 'ws-leave' }))
        await settle()
        dispatcher.message(ws, frame({ type: 'unsub', sub: 's1' }))

        expect(sent).toContainEqual({ type: 'end', sub: 's1' })
        // Last local sub gone → ws leaves the Bun topic.
        expect(unsubscribed).toEqual(['socket:ws-leave'])
    })

    test('sub to an unregistered socket fails with err then end', async () => {
        const dispatcher = createSocketDispatcher(routesFor('ws-known'))
        const { ws, sent } = fakeSocket()

        dispatcher.open(ws)
        dispatcher.message(ws, frame({ type: 'sub', sub: 's1', socket: 'ws-missing' }))
        await settle()

        expect(sent[0]?.type).toBe('err')
        expect(sent[1]).toEqual({ type: 'end', sub: 's1' })
    })

    test('pub on a clientPublish socket fans the message into the retained tail', async () => {
        defineSocket<{ text: string }>('ws-pub', { tail: 10, clientPublish: true })
        const dispatcher = createSocketDispatcher(routesFor('ws-pub'))
        const { ws } = fakeSocket()

        dispatcher.open(ws)
        dispatcher.message(ws, frame({ type: 'pub', socket: 'ws-pub', message: { text: 'hi' } }))
        await settle()

        // Observe the published message through the socket's own retained tail.
        const history = await dispatcher
            .rest(new Request('http://x/__abide/sockets/ws-pub'), 'ws-pub')
            .then((response) => response.json())
        expect(history).toEqual([{ text: 'hi' }])
    })

    test('pub on a non-clientPublish socket is dropped, not thrown', async () => {
        defineSocket('ws-readonly', { tail: 10 })
        const dispatcher = createSocketDispatcher(routesFor('ws-readonly'))
        const { ws } = fakeSocket()

        dispatcher.open(ws)
        dispatcher.message(ws, frame({ type: 'pub', socket: 'ws-readonly', message: 1 }))
        await settle()

        const history = await dispatcher
            .rest(new Request('http://x/__abide/sockets/ws-readonly'), 'ws-readonly')
            .then((response) => response.json())
        expect(history).toEqual([])
    })

    test('close leaves every subscribed topic for the connection', async () => {
        defineSocket('ws-a', { tail: 0 })
        defineSocket('ws-b', { tail: 0 })
        const dispatcher = createSocketDispatcher(routesFor('ws-a', 'ws-b'))
        const { ws, unsubscribed } = fakeSocket()

        dispatcher.open(ws)
        dispatcher.message(ws, frame({ type: 'sub', sub: 's1', socket: 'ws-a' }))
        dispatcher.message(ws, frame({ type: 'sub', sub: 's2', socket: 'ws-b' }))
        await settle()
        dispatcher.close(ws)

        expect(unsubscribed.sort()).toEqual(['socket:ws-a', 'socket:ws-b'])
    })
})
