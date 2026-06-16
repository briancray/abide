import { afterAll, describe, expect, test } from 'bun:test'
import type { SocketClientFrame } from '../src/lib/server/sockets/types/SocketClientFrame.ts'
import { getSocketChannel } from '../src/lib/ui/socketChannel.ts'

/*
Captures every constructed socket so the test can drive open/close and
inspect outbound frames. Static readyState constants mirror the platform's —
the channel compares against `WebSocket.OPEN` / `WebSocket.CONNECTING`.
*/
class FakeWebSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    static instances: FakeWebSocket[] = []
    readyState = FakeWebSocket.CONNECTING
    sent: string[] = []
    private listeners = new Map<string, ((event: { data?: string }) => void)[]>()
    readonly url: string
    constructor(url: string) {
        this.url = url
        FakeWebSocket.instances.push(this)
    }
    addEventListener(type: string, listener: (event: { data?: string }) => void): void {
        const existing = this.listeners.get(type) ?? []
        existing.push(listener)
        this.listeners.set(type, existing)
    }
    send(message: string): void {
        this.sent.push(message)
    }
    close(): void {
        this.readyState = FakeWebSocket.CLOSED
        this.dispatch('close', {})
    }
    open(): void {
        this.readyState = FakeWebSocket.OPEN
        this.dispatch('open', {})
    }
    private dispatch(type: string, event: { data?: string }): void {
        for (const listener of this.listeners.get(type) ?? []) {
            listener(event)
        }
    }
}

/* Just enough document for the channel: `hidden` plus the visibilitychange hook. */
const documentStub = {
    hidden: false,
    listeners: [] as (() => void)[],
    addEventListener(type: string, listener: () => void): void {
        if (type === 'visibilitychange') {
            this.listeners.push(listener)
        }
    },
}

function setHidden(hidden: boolean): void {
    documentStub.hidden = hidden
    for (const listener of documentStub.listeners) {
        listener()
    }
}

function sentFrames(socket: FakeWebSocket): SocketClientFrame[] {
    return socket.sent.map((message) => JSON.parse(message) as SocketClientFrame)
}

const globals = globalThis as Record<string, unknown>
// WebSocket is a real Bun global other test files use — restore it, never delete.
const originalWebSocket = globals.WebSocket
globals.document = documentStub
globals.window = { location: { protocol: 'http:', host: 'localhost:3000' } }
globals.WebSocket = FakeWebSocket

afterAll(() => {
    delete globals.document
    delete globals.window
    globals.WebSocket = originalWebSocket
})

describe('socket channel visibility', () => {
    test('hidden releases the ws; queued resubscribes flush on the visible reconnect', async () => {
        const channel = getSocketChannel()
        const events: string[] = []
        const callbacks = (label: string) => ({
            onMessage: () => events.push(`${label}:message`),
            onReplay: () => events.push(`${label}:replay`),
            onError: () => events.push(`${label}:error`),
            onEnd: () => events.push(`${label}:end`),
            onDisconnect: () => events.push(`${label}:disconnect`),
        })

        channel.subscribe('a', 'chat', undefined, callbacks('a'))
        expect(FakeWebSocket.instances).toHaveLength(1)
        const first = FakeWebSocket.instances[0] as FakeWebSocket
        first.open()
        expect(sentFrames(first)).toEqual([{ type: 'sub', sub: 'a', socket: 'chat' }])

        /* Hiding closes the transport through the normal drop path. */
        setHidden(true)
        expect(first.readyState).toBe(FakeWebSocket.CLOSED)
        expect(events).toEqual(['a:disconnect'])

        /* A consumer resyncing after the disconnect queues; the armed backoff
           attempt fires while hidden and must not open a transport. */
        channel.subscribe('b', 'chat', 1, callbacks('b'))
        await Bun.sleep(300)
        expect(FakeWebSocket.instances).toHaveLength(1)

        /* Visible reconnects and flushes the queued sub frame. */
        setHidden(false)
        expect(FakeWebSocket.instances).toHaveLength(2)
        const second = FakeWebSocket.instances[1] as FakeWebSocket
        second.open()
        expect(sentFrames(second)).toEqual([{ type: 'sub', sub: 'b', socket: 'chat', replay: 1 }])
    })
})
