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
import {
    ABIDE_PREFIX,
    ARGS_PARAM,
    HEALTH_PATH,
    LOGS_PATH,
    RPC_PREFIX,
    SCHEMA_PATH,
    SOCKET_PREFIX,
} from '$shared/internal/PATHS.ts'
import { isThenable } from '$shared/internal/probes.ts'
import type { EndpointShape, Shapes } from '$shared/internal/shapes.ts'
import { decodeArgs, decodeForm, isMultipart } from '$shared/internal/wire.ts'
import { abideLog } from '$shared/log.ts'
import type { Kind, Rpc } from '$shared/transport.ts'
import { serveHealth } from './health.ts'
import { logs } from './logs.ts'
import { headersFor, json } from './responses.ts'
import {
    authorize,
    describeRpc,
    describeSocket,
    nameRpc,
    nameSocket,
    policyOf,
    refuse,
    respond,
    type SocketEvent,
    type SocketPolicy,
    socketPolicyOf,
} from './rpc.ts'
import { server as running } from './running.ts'
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
    /**
     * What the compiler read off each declaration's TYPE, by export name.
     *
     * Absent when the module's types said nothing this could read, and absent entirely from a
     * hand-written `register` — so a shape is something an endpoint gains, never something it needs.
     */
    shapes?: Record<string, Shapes>,
): void {
    for (const [id, name] of entries) {
        const declared = module[name]
        if (declared === undefined) continue
        if (kind === 'rpc') {
            nameRpc(declared as object, id)
            describeRpc(declared as object, shapes?.[name])
            RPCS.set(id, declared as AnyRpc)
        } else {
            nameSocket(declared as object, id)
            describeSocket(declared as object, shapes?.[name])
            SOCKETS.set(id, declared as AnySocket)
        }
    }
}

/** Every address a lane has registered. What a test asks to prove the seam wired itself. */
export function registered(kind: Kind): string[] {
    return [...(kind === 'rpc' ? RPCS : SOCKETS).keys()]
}

/**
 * Every endpoint, as the document a machine reads BEFORE it calls one.
 *
 * This is what the whole shape story is for. An MCP tool definition is `{ name: id, description,
 * inputSchema: input }` and an OpenAPI operation is the same three facts under different names, so
 * neither needs a generator of its own in here — what they needed was for the shape to exist in a
 * form other than a validator, which is why JSON Schema is what a declaration MEANS rather than
 * something abide converts to on the way out.
 *
 * Sorted by address, so two runs of the same app produce the same document and a diff of one is a
 * diff of the API.
 */
export function endpoints(): EndpointShape[] {
    const all: EndpointShape[] = []
    for (const [id, rpc] of RPCS) {
        const policy = policyOf(rpc)
        all.push({
            id,
            kind: 'rpc',
            method: rpc.method,
            ...(rpc.description === undefined ? {} : { description: rpc.description }),
            ...(policy?.streams === true ? { streams: true } : {}),
            ...(policy?.input == null ? {} : { input: policy.input }),
            ...(policy?.output == null ? {} : { output: policy.output }),
        })
    }
    for (const [id, stream] of SOCKETS) {
        const policy = socketPolicyOf(stream)
        all.push({
            id,
            kind: 'socket',
            // A socket never ends, so it is the one endpoint whose `streams` is not worth saying: it
            // is true by construction, and a flag that is always true tells a reader nothing.
            ...(policy?.message == null ? {} : { input: policy.message }),
        })
    }
    all.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return all
}

/**
 * The catalogue as a response. Open, unlike the log feed: every address in it is already in the
 * client bundle, and the shape beside it is the CONTRACT for calling that address — a caller that
 * cannot read it is a caller that gets it wrong and is refused by the same declaration anyway.
 */
function schema(request: Request): Response {
    if (request.method !== 'GET') return refuse('the schema is a GET', 405)
    return json(endpoints())
}

// --- the cross-origin gate ---------------------------------------------------
//
// Closed unless declared. A same-origin call carries no `origin` at all, or one that matches, and
// needs no headers; anything else is a call from somewhere the declaration did not name.

const NOT_CROSS_ORIGIN: Record<string, string> = {}
/** A preflight needs no content-type of its own — it goes through the funnel for the trace alone. */
const NO_DEFAULTS: Record<string, string> = {}

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
    // Latched BEFORE the prefix test — one pointer store — so `server()` is answerable from the first
    // request an app takes, including every one this hands straight back.
    if (server !== undefined) running.set(server)
    // The raw URL text first: `new URL()` parses and allocates, and an app that mounted this in
    // front of its own routes pays that on every request of its own to learn the answer is no. The
    // substring test is a cheap SUPERSET — a query string could carry the prefix — so the parsed
    // pathname below is still what decides.
    if (!request.url.includes(ABIDE_PREFIX)) return undefined
    const url = new URL(request.url)
    const path = url.pathname
    if (!path.startsWith(ABIDE_PREFIX)) return undefined
    // Past this line the request is ABIDE'S, and all of it is served inside one scope — opened here
    // rather than in each lane, so the next `/__abide/*` endpoint does not have to remember to. It is
    // what makes `traceresponse` answerable on every response including the refusals, what gives a
    // socket's `authorize` a `request()` and a `trace()` to ask about, and what makes every
    // module-level `memo` a handler touches belong to this caller and go away with it.
    return serveIfScoped(request, () => served(request, url, path, server))
}

function served(
    request: Request,
    url: URL,
    path: string,
    server: Server<SocketData> | undefined,
): Response | Promise<Response | undefined> {
    if (path.startsWith(SOCKET_PREFIX)) return upgrade(request, url, path, server)
    if (path === LOGS_PATH) return logs(request)
    if (path === SCHEMA_PATH) return schema(request)
    if (path === HEALTH_PATH) return serveHealth(request)
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
    // Through `headersFor` like every other response, so the preflight is not the one thing abide
    // answers with that carries no `traceresponse`.
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: headersFor(headers, NO_DEFAULTS) })
    }

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
        // Three doors, one args object. A read carries them in the query; a body carries them as
        // JSON, or as multipart when one of them is a FILE — and a read arrives that way too, since
        // a file has no text form to put in a URL.
        if (request.method === 'GET') args = decodeArgs(url.searchParams.get(ARGS_PARAM))
        else if (isMultipart(request)) args = decodeForm(await request.formData())
        else args = decodeArgs(await request.text())
    } catch {
        return refuse(`${id} was called with arguments it could not decode`, 400, headers)
    }

    return respond(rpc, args, headers)
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
    // The argument is the exact answer — it is THIS server, whatever else is listening in this
    // process — and the latch is what an app that handed it over some other way already set.
    const target = server ?? running.peek<SocketData>()
    if (target === null) {
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
    return authorized(request, target, id, room, stream, policy)
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
        } catch (bad) {
            return dropped(connection, bad)
        }
        const declared = policy?.checkMessage ?? null
        if (declared === null) return published(connection, accept, message)
        // Guarded like every other step on this path: a schema over a plain object refuses or passes
        // in the call, and this runs once per inbound message.
        let gated: unknown
        try {
            gated = declared(message)
        } catch (refusal) {
            return dropped(connection, refusal)
        }
        if (!isThenable(gated)) return published(connection, accept, gated)
        return (gated as Promise<unknown>).then(
            (checked) => published(connection, accept, checked),
            (refusal: unknown) => dropped(connection, refusal),
        )
    },
}

const socketLog = abideLog.channel('socket')

/**
 * A refused inbound message, on abide's own channel.
 *
 * A DROP rather than a close or a reply: a socket frame has no response to carry a refusal in, and
 * a client that may not publish must not learn the difference between "not allowed" and "not
 * listening". Silent to an operator too was the part that was wrong — the gate is there to control
 * volume, not to hide breakage — so it says so where `DEBUG=abide:*` can see it, and nowhere else.
 */
function dropped(connection: ServerWebSocket<SocketData>, why: unknown): void {
    socketLog.debug(
        `${connection.data.id} dropped a client publish: ${String((why as Error)?.message ?? why)}`,
    )
}

/** Past every gate: the chain runs, and what it lets through is what the app said to do with it. */
function published(
    connection: ServerWebSocket<SocketData>,
    accept: (message: unknown, room: unknown) => void | Promise<void>,
    message: unknown,
): void | Promise<void> {
    const policy = connection.data.policy
    const room = connection.data.room
    if (policy === undefined) return accept(message, room)
    const event: SocketEvent<unknown, unknown> = {
        kind: 'publish',
        room,
        message,
        request: connection.data.request,
    }
    // Guarded rather than awaited: the ordinary socket has no middleware and a synchronous
    // `clientPublish`, and this runs once per inbound message.
    let ran: void | Promise<void>
    try {
        ran = authorize(policy, event)
    } catch (refusal) {
        return dropped(connection, refusal)
    }
    if (!isThenable(ran)) return accept(message, room)
    return ran.then(
        () => accept(message, room),
        // A refusal is a drop, the same as one thrown synchronously above.
        (refusal: unknown) => dropped(connection, refusal),
    )
}
