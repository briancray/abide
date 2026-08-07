// The transport, with the wire taken out of it.
//
// A demo case runs the same body headless AND inside a browser card, and neither place can start a
// server. What CAN run in both is the transport itself: `dispatch` takes a `Request` and hands back
// a `Response`, and the websocket half is one `subscribe` on upgrade — so calling them in-process
// exercises every part of both laws except the frames.
//
// What this therefore cannot claim is the socket and the fetch reconnecting, and the elision of a
// handler's body from a real bundle. Those are asserted in `packages/example/test/transport.test.ts`,
// which spawns a lane with no DOM emulator in it and serves for real.

import { dispatch, websocket } from '$server/registry.ts'
import type { Wire } from '$shared/transport.ts'

/** What `websocket.open` is handed. Structural, because the real one is Bun's and there is none here. */
interface Connection {
    data: unknown
    send(frame: string): void
    close(): void
}

export interface Loopback {
    /** The origin a relative address resolves against. There is no server, so any origin will do. */
    base: string
    /** What a `remote` sends through. */
    fetch(input: string, init: RequestInit): Promise<Response>
    /** What a `remoteSocket` opens through: the real upgrade, and the real subscribe behind it. */
    open(url: string): Wire
    /** How many requests reached `dispatch` — the counter the coalescing claim is made with. */
    requests: number
    /**
     * Connections whose upgrade has COMPLETED.
     *
     * What a case waits on instead of sleeping a span: an upgrade is a detached turn of the loop, and
     * a publish before it lands is dropped — `send` below has no connection to hand it to yet. The
     * real lane's equivalent is Bun's own `server.pendingWebSockets`.
     */
    readonly connected: number
    /** Every connection still open, so a suite does not leave one subscribed to a channel. */
    close(): void
}

export function loopback(base = 'http://abide.test'): Loopback {
    const connections: Connection[] = []

    const self: Loopback = {
        base,
        requests: 0,
        // Derived, not counted: `connections` is already the live set, kept by the upgrade and by
        // both closes.
        get connected(): number {
            return connections.length
        },
        async fetch(input, init) {
            self.requests++
            const answered = await dispatch(new Request(new URL(input, base).href, init))
            // Outside the reserved prefix is the APP's, and `dispatch` says so by handing back
            // nothing at all — which is what an app mounting it in front of its own routes relies on.
            return answered ?? new Response('an app route', { status: 404 })
        },
        open(url) {
            const wire: Wire = {
                onmessage: null,
                onopen: null,
                onclose: null,
                send(frame) {
                    const connection = connected
                    if (connection !== null) void websocket.message(connection as never, frame)
                },
                close() {
                    const connection = connected
                    connected = null
                    if (connection === null) return
                    websocket.close(connection as never)
                    const at = connections.indexOf(connection)
                    if (at >= 0) connections.splice(at, 1)
                    wire.onclose?.()
                },
            }
            let connected: Connection | null = null

            // The real upgrade path: `dispatch` parses the room, runs the socket's own chain, and
            // asks the server to upgrade. The only thing standing in for Bun here is `upgrade`.
            void (async () => {
                let data: unknown
                const server = {
                    upgrade(_request: Request, options: { data: unknown }) {
                        data = options.data
                        return true
                    },
                } as unknown as Parameters<typeof dispatch>[1]
                const refused = await dispatch(new Request(url.replace(/^ws/, 'http')), server)
                if (refused !== undefined || data === undefined) {
                    wire.onclose?.()
                    return
                }
                const connection: Connection = {
                    data,
                    send: (frame) => wire.onmessage?.({ data: frame }),
                    close: () => wire.close(),
                }
                connected = connection
                connections.push(connection)
                websocket.open(connection as never)
                wire.onopen?.()
            })()
            return wire
        },
        close() {
            for (const connection of connections.splice(0)) websocket.close(connection as never)
        },
    }
    return self
}
