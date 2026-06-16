import type { Socket } from '../server/sockets/types/Socket.ts'
import type { SocketClientFrame } from '../server/sockets/types/SocketClientFrame.ts'
import type { SocketServerFrame } from '../server/sockets/types/SocketServerFrame.ts'
import { buildSocketOverChannel } from '../shared/buildSocketOverChannel.ts'
import type { SocketChannel } from '../shared/types/SocketChannel.ts'
import type { SocketSubCallbacks } from '../shared/types/SocketSubCallbacks.ts'

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
    const subs = new Map<string, { socket: string; callbacks: SocketSubCallbacks }>()
    const subsBySocket = new Map<string, Set<string>>()
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
        const message = JSON.stringify(frame)
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message)
            return
        }
        pendingSends.push(message)
    }

    function dropSub(id: string): void {
        const entry = subs.get(id)
        if (!entry) {
            return
        }
        subs.delete(id)
        const set = subsBySocket.get(entry.socket)
        if (set) {
            set.delete(id)
            if (set.size === 0) {
                subsBySocket.delete(entry.socket)
            }
        }
    }

    ws.addEventListener('open', flushPending)
    ws.addEventListener('message', (event) => {
        let frame: SocketServerFrame
        try {
            frame = JSON.parse(event.data as string) as SocketServerFrame
        } catch {
            return
        }
        if (frame.type === 'msg') {
            const targets = subsBySocket.get(frame.socket)
            if (!targets) {
                return
            }
            for (const subId of targets) {
                subs.get(subId)?.callbacks.onMessage(frame.message)
            }
            return
        }
        if (frame.type === 'replay') {
            subs.get(frame.sub)?.callbacks.onReplay(frame.messages)
            return
        }
        const sub = subs.get(frame.sub)
        if (!sub) {
            return
        }
        dropSub(frame.sub)
        if (frame.type === 'end') {
            sub.callbacks.onEnd()
        } else {
            sub.callbacks.onError(frame.message)
        }
    })
    /* A drop after subs are live is unexpected; surface it so iterators unblock
       instead of awaiting a frame that never comes. Idempotent — the first of
       error/close clears subs, the second finds none. error covers a failed
       handshake (no open, no clean close) that close alone would miss. */
    function disconnectAll(): void {
        const active = [...subs.values()]
        subs.clear()
        subsBySocket.clear()
        for (const sub of active) {
            sub.callbacks.onDisconnect()
        }
    }
    ws.addEventListener('close', disconnectAll)
    ws.addEventListener('error', disconnectAll)

    const channel: SocketChannel = {
        subscribe(id, socket, replay, callbacks) {
            subs.set(id, { socket, callbacks })
            let set = subsBySocket.get(socket)
            if (!set) {
                set = new Set()
                subsBySocket.set(socket, set)
            }
            set.add(id)
            send({ type: 'sub', sub: id, socket, replay })
        },
        unsubscribe(id) {
            if (!subs.has(id)) {
                return
            }
            dropSub(id)
            send({ type: 'unsub', sub: id })
        },
        publish: (socket, message) => send({ type: 'pub', socket, message }),
    }

    /* Same Socket<T> builder the browser proxy uses, over this test channel. */
    function socket<T>(name: string): Socket<T> {
        return buildSocketOverChannel<T>(name, () => channel)
    }

    const close = () => ws.close()
    return { socket, close, [Symbol.dispose]: close }
}
