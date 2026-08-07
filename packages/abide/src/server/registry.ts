// The server's side of the address: id → declaration, and the one entry point that dispatches by it.
//
// Nothing here is discovered by scanning the filesystem. The compiler appends a `register(...)` call
// to every transport module it loads, so a handler is reachable exactly when its module was imported
// — the same rule the runtime already follows for scoped `<style>` blocks.
//
// `dispatch` returns `undefined` for anything outside the reserved prefix, which is what lets an app
// mount it in front of its own routes and never think about it again.

import type { Server, ServerWebSocket } from 'bun'
import type { Channel, RoomChannel } from '$shared/channel.ts'
import { ABIDE_PREFIX, ARGS_PARAM, RPC_PREFIX, SOCKET_PREFIX } from '$shared/internal/PATHS.ts'
import { isThenable } from '$shared/internal/probes.ts'
import { decodeArgs } from '$shared/internal/wire.ts'
import type { Kind, Rpc } from '$shared/transport.ts'
import {
    authorize,
    failed,
    nameRpc,
    policyOf,
    respond,
    type SocketEvent,
    type SocketPolicy,
    socketPolicyOf,
} from './rpc.ts'
import { serveIfScoped } from './scopes.ts'

type AnyRpc = Rpc<unknown, unknown>
type AnySocket = Channel<unknown> & RoomChannel<unknown, unknown>

const RPCS = new Map<string, AnyRpc>()
const SOCKETS = new Map<string, AnySocket>()

/**
 * What the compiler appends to a transport module. Also the hand-written spelling — nothing stops an
 * app registering a declaration it built itself, which is what makes a demo of the seam possible.
 */
export function register(
    kind: Kind,
    entries: [id: string, name: string][],
    module: Record<string, unknown>,
): void {
    for (const [id, name] of entries) {
        const declared = module[name]
        if (declared === undefined) continue
        if (kind === 'rpc') {
            nameRpc(declared as object, id)
            RPCS.set(id, declared as AnyRpc)
        } else {
            SOCKETS.set(id, declared as AnySocket)
        }
    }
}

/** Every address a lane has registered. What a test asks to prove the seam wired itself. */
export function registered(kind: Kind): string[] {
    return [...(kind === 'rpc' ? RPCS : SOCKETS).keys()]
}

// --- the cross-origin gate ---------------------------------------------------
//
// Closed unless declared. A same-origin call carries no `origin` at all, or one that matches, and
// needs no headers; anything else is a call from somewhere the declaration did not name.

const NOT_CROSS_ORIGIN: Record<string, string> = {}

function crossOrigin(request: Request, url: URL, allowed: string[] | null): Record<string, string> | null {
    const origin = request.headers.get('origin')
    if (origin === null || origin === url.origin) return NOT_CROSS_ORIGIN
    if (allowed === null) return null
    const open = allowed.includes('*')
    if (!open && !allowed.includes(origin)) return null
    return {
        'access-control-allow-origin': open ? '*' : origin,
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        vary: 'origin',
    }
}

// The message does NOT name abide: it is wrapped as `abide: <address> — <message>` when it reaches a
// caller, and a reader of the raw body has the address in the URL bar already.
function refuse(message: string, status: number, headers?: Record<string, string>): Response {
    return failed('AbideTransportError', message, status, headers)
}

// --- the entry point ---------------------------------------------------------

// The declaration and its policy are RESOLVED ONCE, at the upgrade, and carried on the connection:
// both are fixed for its lifetime, and `message` below runs per inbound frame.
interface SocketData {
    id: string
    room: unknown
    request: Request
    stream: AnySocket
    policy: SocketPolicy | undefined
    unsubscribe: (() => void) | null
}

/**
 * Everything abide serves, and nothing else.
 *
 * Returns `undefined` SYNCHRONOUSLY for a path outside `/__abide/`, so an app's own routes pay one
 * string comparison for abide's endpoints existing rather than a promise per request.
 */
export function dispatch(
    request: Request,
    server?: Server<SocketData>,
): Response | Promise<Response | undefined> | undefined {
    // The raw URL text first: `new URL()` parses and allocates, and an app that mounted this in
    // front of its own routes pays that on every request of its own to learn the answer is no. The
    // substring test is a cheap SUPERSET — a query string could carry the prefix — so the parsed
    // pathname below is still what decides.
    if (!request.url.includes(ABIDE_PREFIX)) return undefined
    const url = new URL(request.url)
    const path = url.pathname
    if (!path.startsWith(ABIDE_PREFIX)) return undefined
    if (path.startsWith(SOCKET_PREFIX)) return upgrade(request, url, path, server)
    if (!path.startsWith(RPC_PREFIX)) return refuse(`nothing is served at ${path}`, 404)
    return call(request, url, path)
}

async function call(request: Request, url: URL, path: string): Promise<Response> {
    const id = path.slice(RPC_PREFIX.length)
    const rpc = RPCS.get(id)
    if (rpc === undefined) return refuse(`no endpoint at ${id}`, 404)
    const policy = policyOf(rpc)
    const headers = crossOrigin(request, url, policy?.crossOrigin ?? null)
    if (headers === null) {
        return refuse(`${id} is not open to ${request.headers.get('origin')}`, 403)
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })

    // A read travels as a GET with its args in the query, and falls back to a POST when they are too
    // long for a URL — so a read accepts both and a mutation accepts only its own method.
    const allowed =
        rpc.method === 'GET'
            ? request.method === 'GET' || request.method === 'POST'
            : request.method === rpc.method
    if (!allowed) return refuse(`${id} is a ${rpc.method}`, 405, headers)

    // The header is read only when there is a ceiling to compare it against: `maxBodySize` defaults
    // to `Infinity`, and nothing declared is over that.
    const ceiling = policy?.maxBodySize ?? Infinity
    if (ceiling !== Infinity) {
        const declared = Number(request.headers.get('content-length') ?? 0)
        if (Number.isFinite(declared) && declared > ceiling) {
            return refuse(`${id} accepts at most ${ceiling} bytes`, 413, headers)
        }
    }

    let args: unknown
    try {
        args =
            request.method === 'GET'
                ? decodeArgs(url.searchParams.get(ARGS_PARAM))
                : decodeArgs(await request.text())
    } catch {
        return refuse(`${id} was called with arguments that are not JSON`, 400, headers)
    }

    // Inside a request scope, so every module-level `memo` the handler touches — including the rpc's
    // own slot — belongs to this caller and goes away with it.
    return serveIfScoped(request, (): Response | Promise<Response> => respond(rpc, args, headers))
}

function upgrade(
    request: Request,
    url: URL,
    path: string,
    server: Server<SocketData> | undefined,
): Response | Promise<Response | undefined> {
    const id = path.slice(SOCKET_PREFIX.length)
    const stream = SOCKETS.get(id)
    if (stream === undefined) return refuse(`no socket at ${id}`, 404)
    if (server === undefined) {
        return refuse('a socket needs the Bun server — `dispatch(request, server)`', 500)
    }
    const policy = socketPolicyOf(stream)
    // A websocket upgrade is not subject to CORS, so the same declaration has to gate it here or a
    // page anywhere could open one.
    if (crossOrigin(request, url, policy?.crossOrigin ?? null) === null) {
        return refuse(`${id} is not open to ${request.headers.get('origin')}`, 403)
    }
    let room: unknown
    try {
        room = decodeArgs(url.searchParams.get(ARGS_PARAM))
    } catch {
        return refuse(`${id} was subscribed to with a room that is not JSON`, 400)
    }
    return authorized(request, server, id, room, stream, policy)
}

async function authorized(
    request: Request,
    server: Server<SocketData>,
    id: string,
    room: unknown,
    stream: AnySocket,
    policy: SocketPolicy | undefined,
): Promise<Response | undefined> {
    if (policy !== undefined) {
        const event: SocketEvent<unknown, unknown> = {
            kind: 'subscribe',
            room,
            message: undefined,
            request,
        }
        try {
            // Guarded, not awaited: a socket with no middleware — the default — has nothing to wait
            // for, and an unconditional await costs a promise wrap and a tick on every upgrade.
            const ran = authorize(policy, event)
            if (isThenable(ran)) await ran
        } catch (error) {
            return refuse(String((error as Error).message ?? error), 403)
        }
    }
    const data: SocketData = { id, room, request, stream, policy, unsubscribe: null }
    // The upgrade IS the subscribe; `open` below attaches it to the channel. Bun answers the
    // handshake itself, so a successful upgrade is a request with no response of its own.
    if (server.upgrade(request, { data })) return undefined
    return refuse(`${id} could not upgrade`, 400)
}

function roomFor(stream: AnySocket, room: unknown): Channel<unknown> {
    return room === undefined ? (stream as Channel<unknown>) : stream(room)
}

/** The websocket half of the mount point, handed straight to `Bun.serve({ websocket })`. */
export const websocket = {
    open(connection: ServerWebSocket<SocketData>): void {
        // This is the entire socket transport: one subscribe. Everything a channel already does —
        // tail, fan-out, the reactive read, rooms — is untouched by it being remote.
        const room = roomFor(connection.data.stream, connection.data.room)
        // One `JSON.stringify` per subscriber per publish: the fan-out hands every listener the same
        // message, so a room with N connections encodes it N times. Caching the last frame by
        // identity was tried and reverted — a message object mutated between two publishes has the
        // same identity and a different value, so the cache would send the stale one.
        connection.data.unsubscribe = room.subscribe((message) => connection.send(JSON.stringify(message)))
    },
    close(connection: ServerWebSocket<SocketData>): void {
        connection.data.unsubscribe?.()
        connection.data.unsubscribe = null
    },
    message(connection: ServerWebSocket<SocketData>, raw: string | Buffer): void | Promise<void> {
        const policy = connection.data.policy
        const accept = policy?.clientPublish ?? false
        // A socket is a broadcast until an app says otherwise: a client that may publish into a room
        // is a client that may write to every subscriber of it.
        if (accept === false) return
        let message: unknown
        try {
            message = JSON.parse(String(raw)) as unknown
        } catch {
            return
        }
        const room = connection.data.room
        if (policy === undefined) return accept(message, room)
        const event: SocketEvent<unknown, unknown> = {
            kind: 'publish',
            room,
            message,
            request: connection.data.request,
        }
        // Guarded rather than awaited, both of them: the ordinary socket has no middleware and a
        // synchronous `clientPublish`, and this runs once per inbound message.
        let ran: void | Promise<void>
        try {
            ran = authorize(policy, event)
        } catch {
            return
        }
        if (!isThenable(ran)) return accept(message, room)
        return ran.then(
            () => accept(message, room),
            // A refusal is a silent drop, the same as one thrown synchronously above.
            () => undefined,
        )
    },
}
