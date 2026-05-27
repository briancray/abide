import type { ServerWebSocket } from 'bun'
import { log } from '../../shared/log.ts'
import { lookupSocket } from './lookupSocket.ts'
import type { SocketClientFrame } from './types/SocketClientFrame.ts'
import type { SocketRoutes } from './types/SocketRoutes.ts'

type SocketDispatcher = {
    open(ws: ServerWebSocket<unknown>): void
    message(ws: ServerWebSocket<unknown>, data: string | Buffer): void
    close(ws: ServerWebSocket<unknown>): void
}

/*
Per-connection state: which sockets this ws is currently subscribed to
(at the Bun-topic level), and which `sub` ids map to which socket. One
ws can hold multiple subs against the same socket (e.g. one with
history, one without); the Bun-topic subscription is reference-counted
so we only `ws.unsubscribe` when the last local sub drops.
*/
type ConnectionState = {
    subToSocket: Map<string, string>
    socketSubs: Map<string, Set<string>>
}

/*
Bridges the framework's socket registry to a single ws per client. All
sockets multiplex over `/__belte/sockets`. Steady-state fan-out rides
Bun's native `server.publish('socket:<name>', frame)` so the dispatcher
is only on the path for sub/unsub bookkeeping and client-initiated pub
validation; the published `msg` frames go from publisher to subscribers
without touching JS per frame.

`sub` opens a subscription: history is replayed (unless the client
passed `tail: true`) directly to this ws, then the ws is added to the
Bun topic. `unsub` drops the local sub and unsubscribes the ws from
the Bun topic if no other local subs remain. `pub` validates the
socket's `allowClientPublish` policy and calls `socket.publish` —
which fans out to in-process iterators and republishes through Bun
to other connected clients.

Module-level lookups are cached per socket name: loading a socket
module triggers its `defineSocket` call, which inserts into the
registry. After that the dispatcher just reads the registry.
*/
export function createSocketDispatcher(sockets: SocketRoutes): SocketDispatcher {
    const moduleCache = new Map<string, Promise<void>>()
    const connections = new WeakMap<ServerWebSocket<unknown>, ConnectionState>()

    function ensureLoaded(name: string): Promise<void> | undefined {
        const existing = moduleCache.get(name)
        if (existing) {
            return existing
        }
        const loader = sockets[name]
        if (!loader) {
            return undefined
        }
        const promise = loader().then(() => undefined)
        moduleCache.set(name, promise)
        return promise
    }

    function send(ws: ServerWebSocket<unknown>, frame: unknown): void {
        if (ws.readyState !== 1) {
            return
        }
        ws.send(JSON.stringify(frame))
    }

    function addSub(state: ConnectionState, name: string, sub: string): boolean {
        state.subToSocket.set(sub, name)
        let subs = state.socketSubs.get(name)
        if (!subs) {
            subs = new Set()
            state.socketSubs.set(name, subs)
        }
        const wasEmpty = subs.size === 0
        subs.add(sub)
        return wasEmpty
    }

    function removeSub(state: ConnectionState, sub: string): string | undefined {
        const name = state.subToSocket.get(sub)
        if (!name) {
            return undefined
        }
        state.subToSocket.delete(sub)
        const subs = state.socketSubs.get(name)
        if (!subs) {
            return undefined
        }
        subs.delete(sub)
        if (subs.size === 0) {
            state.socketSubs.delete(name)
            return name
        }
        return undefined
    }

    async function handleSub(
        ws: ServerWebSocket<unknown>,
        state: ConnectionState,
        frame: Extract<SocketClientFrame, { type: 'sub' }>,
    ): Promise<void> {
        const loader = ensureLoaded(frame.socket)
        if (!loader) {
            send(ws, {
                type: 'err',
                sub: frame.sub,
                message: `[belte] no socket registered at ${frame.socket}`,
            })
            send(ws, { type: 'end', sub: frame.sub })
            return
        }
        try {
            await loader
        } catch (error) {
            log.error(error)
            send(ws, {
                type: 'err',
                sub: frame.sub,
                message: error instanceof Error ? error.message : String(error),
            })
            send(ws, { type: 'end', sub: frame.sub })
            return
        }
        const entry = lookupSocket(frame.socket)
        if (!entry) {
            send(ws, {
                type: 'err',
                sub: frame.sub,
                message: `[belte] socket module at ${frame.socket} did not register a Socket export`,
            })
            send(ws, { type: 'end', sub: frame.sub })
            return
        }
        const isFirstLocalSub = addSub(state, frame.socket, frame.sub)
        if (isFirstLocalSub) {
            ws.subscribe(`socket:${frame.socket}`)
        }
        /*
        Replay history directly to this ws via ws.send (not
        server.publish) so other connected subscribers don't see the
        replay. Live messages published from now on flow through the
        Bun topic the ws just joined; clients may observe live messages
        interleaved with the tail of history, so user payloads should
        carry an id/timestamp when ordering matters.

        `replay === undefined` means full replay (bare `for await`);
        a number is clamped to the buffer length so the client can ask
        for "as many as available, up to N".
        */
        const history = entry.snapshotHistory()
        const replayCount =
            frame.replay === undefined ? history.length : Math.min(frame.replay, history.length)
        if (replayCount > 0) {
            const start = history.length - replayCount
            for (let index = start; index < history.length; index++) {
                send(ws, { type: 'msg', socket: frame.socket, message: history[index] })
            }
        }
    }

    function handleUnsub(
        ws: ServerWebSocket<unknown>,
        state: ConnectionState,
        frame: Extract<SocketClientFrame, { type: 'unsub' }>,
    ): void {
        const emptied = removeSub(state, frame.sub)
        if (emptied) {
            ws.unsubscribe(`socket:${emptied}`)
        }
        send(ws, { type: 'end', sub: frame.sub })
    }

    async function handlePub(
        ws: ServerWebSocket<unknown>,
        frame: Extract<SocketClientFrame, { type: 'pub' }>,
    ): Promise<void> {
        const loader = ensureLoaded(frame.socket)
        if (!loader) {
            return
        }
        try {
            await loader
        } catch (error) {
            log.error(error)
            return
        }
        const entry = lookupSocket(frame.socket)
        if (!entry) {
            return
        }
        if (!entry.allowClientPublish) {
            /*
            Silent drop: the publish is rejected because the topic
            wasn't declared `{ clientPublish: true }`. Surfacing this as
            an error per-publish would tempt apps to attempt-then-handle
            instead of routing through an HTTP route for auth. Log it
            once per process at debug level (out of scope here) if
            visibility is needed.
            */
            return
        }
        /*
        publish() runs the topic's optional Standard Schema synchronously
        and throws on failure (see defineSocket.validateSync). The
        dispatcher invokes us via `void handlePub(...)`, so an unhandled
        throw would surface as an unhandled promise rejection on every
        malformed client frame. Catch + log so a buggy client can't take
        the process down.
        */
        try {
            entry.socket.publish(frame.message)
        } catch (error) {
            log.error(error)
        }
        /*
        ws parameter retained for future per-ws auth context (cookies on
        upgrade) the canPublish hook would consult.
        */
        void ws
    }

    return {
        open(ws) {
            connections.set(ws, { subToSocket: new Map(), socketSubs: new Map() })
        },

        message(ws, data) {
            const state = connections.get(ws)
            if (!state) {
                return
            }
            const text = typeof data === 'string' ? data : data.toString('utf8')
            let frame: SocketClientFrame
            try {
                frame = JSON.parse(text) as SocketClientFrame
            } catch {
                return
            }
            if (frame.type === 'sub') {
                void handleSub(ws, state, frame)
                return
            }
            if (frame.type === 'unsub') {
                handleUnsub(ws, state, frame)
                return
            }
            if (frame.type === 'pub') {
                void handlePub(ws, frame)
                return
            }
        },

        close(ws) {
            const state = connections.get(ws)
            if (!state) {
                return
            }
            connections.delete(ws)
            for (const name of state.socketSubs.keys()) {
                ws.unsubscribe(`socket:${name}`)
            }
        },
    }
}
