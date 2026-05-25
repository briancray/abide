import type { SocketClientFrame } from '../types/SocketClientFrame.ts'
import type { SocketServerFrame } from '../types/SocketServerFrame.ts'

type Subscription = {
    onFrame(value: unknown): void
    onDone(): void
    onError(message: string): void
}

type Channel = {
    subscribe(id: string, url: string, args: unknown, sub: Subscription): void
    unsubscribe(id: string): void
}

const SOCKET_PATH = '/__belte/socket'

let singleton: Channel | undefined

/*
Lazily opens the single multiplexed ws connection used by every
socketProxy call on the page, and routes inbound `frame|done|error`
frames back to the per-call subscription that owns the matching id.

Outbound frames sent before `ws.onopen` fires are queued and flushed on
open. The channel reconnects on close with a bounded backoff: in-flight
subscriptions are torn down with a synthetic error so callers' `for await`
loops can surface the disconnect, then the connection comes back up and
fresh calls can subscribe again. We intentionally do not silently re-
subscribe across a reconnect — most stream consumers need to reconcile
state on a fresh connection (e.g. re-fetch a snapshot before reapplying
deltas), so the framework hands the disconnect to user code instead of
papering over it.
*/
export function getSocketRouteChannel(): Channel {
    if (singleton) {
        return singleton
    }
    const subscriptions = new Map<string, Subscription>()
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
        ws = new WebSocket(`${scheme}//${window.location.host}${SOCKET_PATH}`)
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
            const sub = subscriptions.get(frame.id)
            if (!sub) {
                return
            }
            if (frame.type === 'frame') {
                sub.onFrame(frame.value)
            } else if (frame.type === 'done') {
                subscriptions.delete(frame.id)
                sub.onDone()
            } else {
                subscriptions.delete(frame.id)
                sub.onError(frame.message)
            }
        })
        ws.addEventListener('close', () => {
            const active = [...subscriptions.entries()]
            subscriptions.clear()
            for (const [, sub] of active) {
                sub.onError('socket disconnected')
            }
            ws = undefined
            if (active.length === 0 && pendingSends.length === 0) {
                return
            }
            setTimeout(connect, backoffMs)
            backoffMs = Math.min(backoffMs * 2, 5000)
        })
    }

    singleton = {
        subscribe(id, url, args, sub) {
            subscriptions.set(id, sub)
            send({ type: 'open', id, url, args })
        },
        unsubscribe(id) {
            if (!subscriptions.delete(id)) {
                return
            }
            send({ type: 'close', id })
        },
    }
    return singleton
}
