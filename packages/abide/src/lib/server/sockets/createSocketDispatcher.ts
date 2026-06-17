import type { ServerWebSocket } from 'bun'
import { abideLog } from '../../shared/abideLog.ts'
import { memoizeByKey } from '../../shared/memoizeByKey.ts'
import { messageFromError } from '../../shared/messageFromError.ts'
import { error } from '../error.ts'
import { json } from '../json.ts'
import { sse } from '../sse.ts'
import { lookupSocket } from './lookupSocket.ts'
import type { SocketClientFrame } from './types/SocketClientFrame.ts'
import type { SocketRegistryEntry } from './types/SocketRegistryEntry.ts'
import type { SocketRoutes } from './types/SocketRoutes.ts'
import type { SocketServerFrame } from './types/SocketServerFrame.ts'

// Reused across every inbound binary frame rather than allocated per message.
const textDecoder = new TextDecoder()

/* Socket REST-face spans (CLI/MCP tail + publish), opt-in via DEBUG=abide:sockets. */
const socketsLog = abideLog.channel('abide:sockets')

type SocketDispatcher = {
    open(ws: ServerWebSocket<unknown>): void
    message(ws: ServerWebSocket<unknown>, data: string | Buffer): void
    close(ws: ServerWebSocket<unknown>): void
    rest(req: Request, name: string): Promise<Response>
}

/*
Per-connection state: which sockets this ws is currently subscribed to
(at the Bun-topic level), and which `sub` ids map to which socket. One
ws can hold multiple subs against the same socket (e.g. one seeded
from the retained tail, one live-only); the Bun-topic subscription is reference-counted
so we only `ws.unsubscribe` when the last local sub drops.
*/
type ConnectionState = {
    subToSocket: Map<string, string>
    socketSubs: Map<string, Set<string>>
}

/*
Bridges the framework's socket registry to a single ws per client. All
sockets multiplex over `/__abide/sockets`. Steady-state fan-out rides
Bun's native `server.publish('socket:<name>', frame)` so the dispatcher
is only on the path for sub/unsub bookkeeping and client-initiated pub
validation; the published `msg` frames go from publisher to subscribers
without touching JS per frame.

`sub` opens a subscription: the requested slice of the retained tail
is replayed directly to this ws, then the ws is added to the Bun
topic. `unsub` drops the local sub and unsubscribes the ws from
the Bun topic if no other local subs remain. `pub` validates the
socket's `allowClientPublish` policy and calls `socket.publish` —
which fans out to in-process iterators and republishes through Bun
to other connected clients.

Module-level lookups are cached per socket name: loading a socket
module triggers its `defineSocket` call, which inserts into the
registry. After that the dispatcher just reads the registry.
*/
export function createSocketDispatcher(sockets: SocketRoutes): SocketDispatcher {
    const connections = new WeakMap<ServerWebSocket<unknown>, ConnectionState>()

    const ensureLoaded = memoizeByKey((name): Promise<void> | undefined => {
        const loader = sockets[name]
        return loader ? loader().then(() => undefined) : undefined
    })

    /*
    Loads a socket module on first use and reads its registry entry — the
    one statement of the load/lookup failure semantics (a throwing module is
    logged here and stays cached as failed by ensureLoaded). Each face maps
    the failure kind to its own rendering: sub emits err+end frames, pub
    drops silently, rest answers with HTTP errors.
    */
    async function resolveEntry(
        name: string,
    ): Promise<
        | { entry: SocketRegistryEntry }
        | { failure: 'unregistered' | 'load-failed' | 'no-export'; message: string }
    > {
        const loader = ensureLoaded(name)
        if (!loader) {
            return { failure: 'unregistered', message: `[abide] no socket registered at ${name}` }
        }
        try {
            await loader
        } catch (loadError) {
            abideLog.error(loadError)
            return {
                failure: 'load-failed',
                message: messageFromError(loadError),
            }
        }
        const entry = lookupSocket(name)
        if (!entry) {
            return {
                failure: 'no-export',
                message: `[abide] socket module at ${name} did not register a Socket export`,
            }
        }
        return { entry }
    }

    function send(ws: ServerWebSocket<unknown>, frame: SocketServerFrame): void {
        if (ws.readyState !== WebSocket.OPEN) {
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
        // Reject this sub: emit the error then the terminal end frame for its id.
        function fail(message: string): void {
            send(ws, { type: 'err', sub: frame.sub, message })
            send(ws, { type: 'end', sub: frame.sub })
        }
        const resolution = await resolveEntry(frame.socket)
        if ('failure' in resolution) {
            return fail(resolution.message)
        }
        const { entry } = resolution
        const isFirstLocalSub = addSub(state, frame.socket, frame.sub)
        if (isFirstLocalSub) {
            ws.subscribe(`socket:${frame.socket}`)
        }
        /*
        Replay rides one per-sub `replay` frame (sent even when empty), not
        socket-keyed msg frames: the batch demarcates replay from live for
        the reader, and the per-sub address keeps this sub's replay out of
        sibling subs on the same socket. Live messages flow through the Bun
        topic the ws just joined; a frame published between the join and
        this snapshot can appear in both, so user payloads should carry an
        id/timestamp when ordering matters.

        `replay === undefined` means the whole retained tail (`.tail()`
        no-arg); a number is clamped to the buffer length so the client
        can ask for "as many as available, up to N" — `0` (bare
        `for await`) replays nothing.
        */
        send(ws, { type: 'replay', sub: frame.sub, messages: entry.snapshotTail(frame.replay) })
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
        const resolution = await resolveEntry(frame.socket)
        if ('failure' in resolution) {
            return
        }
        const { entry } = resolution
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
        } catch (publishError) {
            abideLog.error(publishError)
        }
        /*
        ws parameter retained for future per-ws auth context (cookies on
        upgrade) the canPublish hook would consult.
        */
        void ws
    }

    /*
    HTTP face of the sockets hub at `/__abide/sockets/<name>`, for the CLI
    and MCP (which can't speak the ws multiplex protocol):

      GET  text/event-stream → live SSE stream; `?tail=N` seeds with the
           last N retained frames before tailing live (default 0 = live only).
      GET  otherwise         → JSON array of the retained tail
           (`?tail=N` caps it; default all).
      POST                   → publish the JSON body, gated by the socket's
           clientPublish policy and validated against its schema.

    Loads the socket module on first hit (same cache the ws path uses) so
    its defineSocket call populates the registry.
    */
    async function rest(req: Request, name: string): Promise<Response> {
        return socketsLog.trace(`socket-rest ${name}`, () => restImpl(req, name))
    }

    async function restImpl(req: Request, name: string): Promise<Response> {
        const resolution = await resolveEntry(name)
        if ('failure' in resolution) {
            return resolution.failure === 'load-failed'
                ? error(500, 'socket failed to load')
                : error(404)
        }
        const { entry } = resolution
        const tailParam = new URL(req.url).searchParams.get('tail')
        const parsedTail = tailParam !== null ? Number(tailParam) : undefined
        // A non-numeric ?tail= yields NaN; treat it as absent rather than letting
        // snapshotTail(NaN)/slice(NaN) leak the whole retained buffer.
        const count =
            parsedTail !== undefined && Number.isFinite(parsedTail) ? parsedTail : undefined
        if (req.method === 'GET' || req.method === 'HEAD') {
            if ((req.headers.get('accept') ?? '').includes('text/event-stream')) {
                return sse(entry.socket.tail(count ?? 0))
            }
            return json(entry.snapshotTail(count))
        }
        if (req.method === 'POST') {
            if (!entry.allowClientPublish) {
                return error(403, 'publishing not allowed')
            }
            let message: unknown
            try {
                message = await req.json()
            } catch {
                return error(400, 'body must be JSON')
            }
            try {
                // publish() validates against the socket schema and throws on a bad payload.
                entry.socket.publish(message)
            } catch (publishError) {
                return error(422, messageFromError(publishError))
            }
            return json({ ok: true })
        }
        return error(405, undefined, { headers: { Allow: 'GET, POST' } })
    }

    return {
        rest,

        open(ws) {
            connections.set(ws, { subToSocket: new Map(), socketSubs: new Map() })
        },

        message(ws, data) {
            const state = connections.get(ws)
            if (!state) {
                return
            }
            const text = typeof data === 'string' ? data : textDecoder.decode(data)
            let frame: SocketClientFrame
            try {
                frame = JSON.parse(text) as SocketClientFrame
            } catch {
                return
            }
            // JSON.parse succeeds on `null`/`42`/`true`; ignore anything that isn't a frame object.
            if (typeof frame !== 'object' || frame === null) {
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
