import type { SocketClientFrame } from '../server/sockets/types/SocketClientFrame.ts'
import type { SocketServerFrame } from '../server/sockets/types/SocketServerFrame.ts'
import { createSocketSubRegistry } from '../shared/createSocketSubRegistry.ts'
import { SOCKETS_PATH } from '../shared/SOCKETS_PATH.ts'
import type { SocketChannel } from '../shared/types/SocketChannel.ts'
import { withBase } from '../shared/withBase.ts'

let singleton: SocketChannel | undefined

/*
Lazily opens the single multiplexed ws used by every socket proxy on the page.
The sub registry + inbound `msg`/`replay`/`end`/`err` routing lives in
`createSocketSubRegistry` (shared with the test harness); this channel owns the
transport that wraps it — connect, reconnect/backoff, and visibility.

Outbound frames sent before `ws.onopen` fires are queued and flushed
on open. The channel reconnects on close with bounded backoff;
in-flight subs are torn down with the typed disconnect signal so
consumers' `for await` loops can surface it, then the connection
comes back up and fresh subs can be opened. The channel itself never
re-subscribes across a reconnect — it can't know consumer semantics;
a delta consumer must reconcile state on a fresh connection (e.g.
re-fetch a snapshot before reapplying deltas). tail() opts in
above this layer because its latest-wins/window semantics make replay a
correct reconciliation; raw `for await` consumers keep manual control.

While the backoff timer is armed, `connect()` defers to it: a consumer
re-subscribing in reaction to the disconnect would otherwise trigger an
immediate reconnect on every failure cycle, defeating the backoff. Its
frames queue in `pendingSends` and flush when the timer's attempt opens.

Hidden tabs hold no transport: `visibilitychange: hidden` closes the ws
through the normal drop path above — subs tear down with the typed
disconnect, and a resyncing consumer's fresh sub frames queue (connect()
refuses to open while hidden) until the visible transition reconnects and
flushes them.
*/
export function getSocketChannel(): SocketChannel {
    if (singleton) {
        return singleton
    }
    let ws: WebSocket | undefined
    let pendingSends: string[] = []
    let backoffMs = 250
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

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

    /* The local sub registry + inbound frame routing; this channel owns only the
       transport (connect/reconnect/backoff/visibility) around it. */
    const registry = createSocketSubRegistry(send)

    function connect(): void {
        /* Backoff window owns reconnection; queued frames flush when its attempt opens. */
        if (reconnectTimer !== undefined) {
            return
        }
        /* Hidden tabs hold no transport — frames queue, the visibility listener reconnects. */
        if (document.hidden) {
            return
        }
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return
        }
        const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        // The mount base routes the upgrade through the proxy (/v2/__abide/sockets).
        ws = new WebSocket(`${scheme}//${window.location.host}${withBase(SOCKETS_PATH)}`)
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
            registry.routeFrame(frame)
        })
        ws.addEventListener('close', () => {
            const active = registry.drainSubs()
            /*
            Drop any queued frames too. We've just torn down every local
            sub, so replaying their `sub`/`unsub`/`pub` frames on
            reconnect would open ghost subscriptions on the server that
            no client object tracks (and never gets an `unsub`). This
            keeps the "channel never re-subscribes" contract above
            honest — consumers re-open fresh subs. `drainSubs` cleared the
            registry before these callbacks run so a consumer reacting to
            the disconnect (its catch resolves in a microtask, after this
            handler) registers onto a fresh list.
            */
            const hadPending = pendingSends.length > 0
            pendingSends = []
            ws = undefined
            for (const callbacks of active) {
                callbacks.onDisconnect()
            }
            if (active.length === 0 && !hadPending) {
                return
            }
            reconnectTimer = setTimeout(() => {
                reconnectTimer = undefined
                connect()
            }, backoffMs)
            backoffMs = Math.min(backoffMs * 2, 5000)
        })
    }

    /*
    Release the ws when the tab hides rather than hold an idle connection the
    browser throttles. Closing rides the normal drop path (close handler →
    typed disconnect → consumers resync), so by the visible transition the
    resubscribed frames sit in `pendingSends` waiting for the reconnect.
    */
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            ws?.close()
            return
        }
        if (pendingSends.length > 0) {
            connect()
        }
    })

    singleton = registry.channel
    return singleton
}
