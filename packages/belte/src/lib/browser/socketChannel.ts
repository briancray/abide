import type { SocketClientFrame } from '../server/sockets/types/SocketClientFrame.ts'
import type { SocketServerFrame } from '../server/sockets/types/SocketServerFrame.ts'

type SubCallbacks = {
    onMessage(message: unknown): void
    onError(message: string): void
    onEnd(): void
}

type Channel = {
    subscribe(
        sub: string,
        socket: string,
        replay: number | undefined,
        callbacks: SubCallbacks,
    ): void
    unsubscribe(sub: string): void
    publish(socket: string, message: unknown): void
}

const SOCKETS_PATH = '/__belte/sockets'

let singleton: Channel | undefined

/*
Lazily opens the single multiplexed ws used by every socket proxy on
the page. Routes inbound frames:
  `msg` → all local subs of that socket
  `end` → the matching sub
  `err` → the matching sub

`msg` frames carry no sub id: one publish from the server fans out to
every connected ws via Bun's native publish, and each ws delivers the
message to every local sub of that socket. `end`/`err` are per-sub
because they're subscription-lifecycle events, not data.

Outbound frames sent before `ws.onopen` fires are queued and flushed
on open. The channel reconnects on close with bounded backoff;
in-flight subs are torn down with a synthetic error so consumers'
`for await` loops can surface the disconnect, then the connection
comes back up and fresh subs can be opened. We intentionally do not
silently re-subscribe across a reconnect — most socket consumers need
to reconcile state on a fresh connection (e.g. re-fetch a snapshot
before reapplying deltas), so the framework hands the disconnect to
user code instead of papering over it.
*/
export function getSocketChannel(): Channel {
    if (singleton) {
        return singleton
    }
    const subs = new Map<string, { socket: string; callbacks: SubCallbacks }>()
    const subsBySocket = new Map<string, Set<string>>()
    let ws: WebSocket | undefined
    let pendingSends: string[] = []
    let backoffMs = 250

    function flushPending(): void {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return
        }
        for (const message of pendingSends) {
            ws.send(message)
        }
        pendingSends = []
    }

    function send(frame: SocketClientFrame): void {
        const message = JSON.stringify(frame)
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(message)
            return
        }
        pendingSends.push(message)
        connect()
    }

    function connect(): void {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return
        }
        const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        ws = new WebSocket(`${scheme}//${window.location.host}${SOCKETS_PATH}`)
        ws.addEventListener('open', () => {
            backoffMs = 250
            flushPending()
        })
        ws.addEventListener('message', (event) => {
            let frame: SocketServerFrame
            try {
                frame = JSON.parse(event.data) as SocketServerFrame
            } catch {
                return
            }
            if (frame.type === 'msg') {
                /*
                One Bun-published frame fans out to every local sub of
                that socket on this ws — addressed by socket name, not
                per-sub id.
                */
                const targets = subsBySocket.get(frame.socket)
                if (!targets) {
                    return
                }
                for (const subId of targets) {
                    subs.get(subId)?.callbacks.onMessage(frame.message)
                }
                return
            }
            if (frame.type === 'end') {
                const sub = subs.get(frame.sub)
                if (!sub) {
                    return
                }
                dropSub(frame.sub)
                sub.callbacks.onEnd()
                return
            }
            if (frame.type === 'err') {
                const sub = subs.get(frame.sub)
                if (!sub) {
                    return
                }
                dropSub(frame.sub)
                sub.callbacks.onError(frame.message)
                return
            }
        })
        ws.addEventListener('close', () => {
            const active = [...subs.entries()]
            subs.clear()
            subsBySocket.clear()
            for (const [, sub] of active) {
                sub.callbacks.onError('socket channel disconnected')
            }
            /*
            Drop any queued frames too. We've just torn down every local
            sub, so replaying their `sub`/`unsub`/`pub` frames on
            reconnect would open ghost subscriptions on the server that
            no client object tracks (and never gets an `unsub`). This
            keeps the "no silent re-subscribe across a reconnect"
            contract above honest — consumers re-open fresh subs.
            */
            const hadPending = pendingSends.length > 0
            pendingSends = []
            ws = undefined
            if (active.length === 0 && !hadPending) {
                return
            }
            setTimeout(connect, backoffMs)
            backoffMs = Math.min(backoffMs * 2, 5000)
        })
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

    singleton = {
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
        publish(socket, message) {
            send({ type: 'pub', socket, message })
        },
    }
    return singleton
}
