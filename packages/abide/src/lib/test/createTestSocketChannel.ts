import type { Socket } from '../server/sockets/types/Socket.ts'
import type { SocketClientFrame } from '../server/sockets/types/SocketClientFrame.ts'
import type { SocketServerFrame } from '../server/sockets/types/SocketServerFrame.ts'
import { buildSocketOverChannel } from '../shared/buildSocketOverChannel.ts'
import { createSocketSubRegistry } from '../shared/createSocketSubRegistry.ts'
import { decodeRefJson } from '../shared/decodeRefJson.ts'
import { encodeRefJson } from '../shared/encodeRefJson.ts'

/*
Test-side substitute for the browser socketChannel: one ws to the booted
server's multiplex, speaking the same SocketClientFrame/SocketServerFrame
protocol. Stripped of the browser channel's reconnect/backoff/visibility
machinery — a test owns the connection lifecycle through `close()`, so a drop
is teardown, not something to recover from. Frames sent before the ws opens
queue and flush on open, the one piece of timing a test can't sidestep.

Implements SocketChannel (subscribe/unsubscribe/publish), so `socket(name)`
hands its sockets to the same buildSocketOverChannel the browser socketProxy
uses — the Socket<T> surface can't drift between the test path and production.
*/
export function createTestSocketChannel(wsUrl: string): {
    socket: <T>(name: string) => Socket<T>
    close: () => void
    /* `using channel = createTestSocketChannel(url)` — disposal closes the ws. */
    [Symbol.dispose]: () => void
} {
    let pendingSends: string[] = []

    const ws = new WebSocket(wsUrl)

    function flushPending(): void {
        if (ws.readyState !== WebSocket.OPEN) {
            return
        }
        for (const message of pendingSends) {
            ws.send(message)
        }
        pendingSends = []
    }

    function send(frame: SocketClientFrame): void {
        // ref-json, matching the browser channel + the server's dispatcher/publish codec.
        const message = encodeRefJson(frame)
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message)
            return
        }
        pendingSends.push(message)
    }

    /* Same sub registry + frame routing the browser channel uses; this harness owns
       only the bare ws (no reconnect — a test drives the lifecycle through close()). */
    const registry = createSocketSubRegistry(send)

    ws.addEventListener('open', flushPending)
    ws.addEventListener('message', (event) => {
        let frame: SocketServerFrame
        try {
            // The server sends ref-json frames (createSocketDispatcher/defineSocket); decode to match.
            frame = decodeRefJson(event.data as string) as SocketServerFrame
        } catch {
            return
        }
        registry.routeFrame(frame)
    })
    /* A drop after subs are live is unexpected; surface it so iterators unblock
       instead of awaiting a frame that never comes. Idempotent — the first of
       error/close drains the subs, the second finds none. error covers a failed
       handshake (no open, no clean close) that close alone would miss. */
    function disconnectAll(): void {
        for (const callbacks of registry.drainSubs()) {
            callbacks.onDisconnect()
        }
    }
    ws.addEventListener('close', disconnectAll)
    ws.addEventListener('error', disconnectAll)

    /* Same Socket<T> builder the browser proxy uses, over this test channel. */
    function socket<T>(name: string): Socket<T> {
        return buildSocketOverChannel<T>(name, () => registry.channel)
    }

    const close = () => ws.close()
    return { socket, close, [Symbol.dispose]: close }
}
