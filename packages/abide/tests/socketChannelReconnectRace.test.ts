import { afterAll, describe, expect, test } from 'bun:test'
/* Query suffix => a fresh module instance with its own channel singleton, so this
   file's channel can't collide with the one socketChannelVisibility.test.ts holds
   (the singleton is process-wide and bleeds across test files otherwise). The suffixed
   specifier has no separate .d.ts, hence the suppression. */
// @ts-expect-error — query-suffixed specifier resolves at runtime, not for types
import { getSocketChannel } from '../src/lib/ui/socketChannel.ts?reconnect-race'

/*
Regression for the reconnect-while-CLOSING clobber. The sibling visibility
test's fake closes synchronously, which hides the bug: a real `ws.close()`
moves to CLOSING and fires `close` later. This fake models that deferred
close — close() only arms CLOSING; flushClose() delivers the event — so the
window where connect() could spawn a second socket on top of a still-closing
one is reachable.
*/
class FakeWebSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    static instances: FakeWebSocket[] = []
    readyState = FakeWebSocket.CONNECTING
    private listeners = new Map<string, (() => void)[]>()
    constructor() {
        FakeWebSocket.instances.push(this)
    }
    addEventListener(type: string, listener: () => void): void {
        const existing = this.listeners.get(type) ?? []
        existing.push(listener)
        this.listeners.set(type, existing)
    }
    send(): void {}
    /* Deferred close, like the platform: CLOSING now, `close` event on flushClose(). */
    close(): void {
        if (this.readyState === FakeWebSocket.CLOSED) {
            return
        }
        this.readyState = FakeWebSocket.CLOSING
    }
    flushClose(): void {
        this.readyState = FakeWebSocket.CLOSED
        this.dispatch('close')
    }
    open(): void {
        this.readyState = FakeWebSocket.OPEN
        this.dispatch('open')
    }
    private dispatch(type: string): void {
        for (const listener of this.listeners.get(type) ?? []) {
            listener()
        }
    }
}

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

const globals = globalThis as Record<string, unknown>
const originalWebSocket = globals.WebSocket
globals.document = documentStub
globals.window = { location: { protocol: 'http:', host: 'localhost:3000' } }
globals.WebSocket = FakeWebSocket

afterAll(() => {
    delete globals.document
    delete globals.window
    globals.WebSocket = originalWebSocket
})

describe('socket channel reconnect race', () => {
    test('a visible transition while the ws is still closing does not spawn a second socket', async () => {
        const channel = getSocketChannel()
        const noop = {
            onMessage() {},
            onReplay() {},
            onError() {},
            onEnd() {},
            onDisconnect() {},
        }

        channel.subscribe('a', 'chat', undefined, noop)
        const first = FakeWebSocket.instances[0] as FakeWebSocket
        first.open()

        /* Hide arms the deferred close (CLOSING, no event yet). */
        setHidden(true)
        expect(first.readyState).toBe(FakeWebSocket.CLOSING)

        /* A resync queues while hidden; connect() bails (hidden). */
        channel.subscribe('b', 'chat', 1, noop)

        /* Becoming visible must NOT open a fresh socket while `first` is still
           closing — the deferred close handler owns nulling `ws` and reconnecting,
           so a second socket here would be orphaned and clobbered. */
        setHidden(false)
        expect(FakeWebSocket.instances).toHaveLength(1)

        /* The real close arrives; its handler nulls `ws` and arms the backoff. The
           reconnect that follows opens exactly one fresh socket — never stranded. */
        first.flushClose()
        await Bun.sleep(300)
        expect(FakeWebSocket.instances).toHaveLength(2)
    })
})
