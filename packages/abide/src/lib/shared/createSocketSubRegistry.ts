import type { SocketClientFrame } from '../server/sockets/types/SocketClientFrame.ts'
import type { SocketServerFrame } from '../server/sockets/types/SocketServerFrame.ts'
import type { SocketChannel } from './types/SocketChannel.ts'
import type { SocketSubCallbacks } from './types/SocketSubCallbacks.ts'

/*
The multiplex bookkeeping every SocketChannel shares: the local subscription
registry plus the inbound `SocketServerFrame` routing. A channel supplies only
its transport (`send`, and when to call `drainSubs` on a drop); everything that
encodes the wire contract — how a `msg` fans out to a socket's subs, how
`replay`/`end`/`err` address one sub — lives here once, so the browser multiplex
and the test harness cannot drift on the protocol (ADR-0005).

`send` carries an outbound client frame however the channel can (the browser
queues until open and reconnects; the test harness queues until open). Routing
and the registry never touch the transport, so they stay identical across both.
*/
export function createSocketSubRegistry(send: (frame: SocketClientFrame) => void): {
    channel: SocketChannel
    routeFrame: (frame: SocketServerFrame) => void
    drainSubs: () => SocketSubCallbacks[]
} {
    const subs = new Map<string, { socket: string; callbacks: SocketSubCallbacks }>()
    /* Reverse index for `msg` fan-out: one server publish addresses a socket, not a sub. */
    const subsBySocket = new Map<string, Set<string>>()

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

    /*
    Routes one inbound frame to its sub(s):
      `msg`    → every local sub of that socket (addressed by socket name)
      `replay` → the one sub that requested the seed (its batched tail)
      `end`/`err` → the one sub, dropped first so its iterator can't take another frame
    A frame for an unknown sub/socket is ignored — a sub torn down between request
    and delivery.
    */
    function routeFrame(frame: SocketServerFrame): void {
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
    }

    /* Tear down every sub on a transport drop and hand the caller their callbacks.
       Clears the registry BEFORE the caller runs `onDisconnect`, so a consumer that
       re-subscribes in reaction (in a later microtask) registers onto fresh state. */
    function drainSubs(): SocketSubCallbacks[] {
        const active = [...subs.values()].map((entry) => entry.callbacks)
        subs.clear()
        subsBySocket.clear()
        return active
    }

    const channel: SocketChannel = {
        subscribe(id, socket, replay, callbacks) {
            subs.set(id, { socket, callbacks })
            /* Not getOrInsertComputed: browser-side code, and Safari/Chrome only shipped it within the last browser cycle (26.2 / 145). */
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

    return { channel, routeFrame, drainSubs }
}
