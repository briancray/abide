// The server's side of the address: id → declaration, and the one entry point that dispatches by it.
//
// Nothing here is discovered by scanning the filesystem. The compiler appends a `register(...)` call
// to every transport module it loads, so a handler is reachable exactly when its module was imported
// — the same rule the runtime already follows for scoped `<style>` blocks.
//
// `dispatch` returns `undefined` for anything outside the reserved prefix, which is what lets an app
// mount it in front of its own routes and never think about it again.

import type { Server, ServerWebSocket } from 'bun'
import type { Channel, KeyedChannel } from '$shared/channel.ts'
import { mountBase } from '$shared/internal/mount.ts'
import {
    ABIDE_PREFIX,
    HEALTH_PATH,
    IDENTITY_PATH,
    LOGS_PATH,
    RPC_PREFIX,
    SCHEMA_PATH,
    SOCKET_PREFIX,
} from '$shared/internal/PATHS.ts'
import { isThenable } from '$shared/internal/probes.ts'
import type { EndpointShape, Shapes } from '$shared/internal/shapes.ts'
import { decodeArgs, decodeForm, decodeQuery, isForm } from '$shared/internal/wire.ts'
import { abideLog } from '$shared/log.ts'
import type { Kind, Rpc } from '$shared/transport.ts'
import { config } from './config.ts'
import { serveHealth } from './health.ts'
import { serveIdentity } from './identity.ts'
import { logs } from './logs.ts'
import { headersFor, json } from './responses.ts'
import {
    authorize,
    bodyCeiling,
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
type AnySocket = Channel<unknown> & KeyedChannel<unknown, unknown>

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

/**
 * What "same origin" MEANS to this process: `APP_URL` when an app declared one, else the request's
 * own origin.
 *
 * The declared one is the stronger answer, not merely the more convenient. `url.origin` comes off
 * the request line and the `Host` header, both of which the caller controls — so a gate comparing an
 * attacker's `Origin` against an attacker's `Host` is comparing two halves of the same claim.
 * `APP_URL` is the operator saying what the app is actually served at, which is also what makes
 * same-origin work behind TLS termination, where `url.origin` is whatever the proxy passed through.
 *
 * Cut once per declared value rather than per request: a public URL does not change under a running
 * process, and both gates ask this per call.
 */
let originSource: string | null = null
let originValue: string | null = null

function ownOrigin(url: URL): string {
    const declared = config().APP_URL
    if (declared === null) return url.origin
    if (declared !== originSource) {
        originSource = declared
        try {
            originValue = new URL(declared).origin
        } catch {
            originValue = null
            abideLog
                .channel('config')
                .warning(
                    `APP_URL is not a URL (${declared}) — the origin gates fall back to the request's own`,
                )
        }
    }
    return originValue ?? url.origin
}

function crossOrigin(request: Request, url: URL, allowed: string[] | null): Record<string, string> | null {
    const origin = request.headers.get('origin')
    if (origin === null || origin === ownOrigin(url)) return NOT_CROSS_ORIGIN
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

// What is fixed at the UPGRADE and carried for the connection's lifetime is the endpoint `id` and its
// `policy`. The declaration and the room it selects are resolved at `open` instead — see `channel`
// below for why. `message` runs per inbound frame and re-resolves neither.
interface SocketData {
    id: string
    room: unknown
    /**
     * The room itself: what the fan-out subscribes to and what a publish goes into.
     *
     * Resolved at OPEN and not at the upgrade, because SELECTING a room is what creates one — and a
     * handshake that never becomes a connection would then leave a room behind that nothing will
     * ever subscribe to, and so nothing will ever drop. The room name comes off the query string, so
     * that is one room per malformed request.
     */
    channel: Channel<unknown> | null
    request: Request
    policy: SocketPolicy | undefined
}

/**
 * One channel subscription per ROOM, and the connections it feeds.
 *
 * A subscription per connection encoded the same message once per subscriber: `publish` hands every
 * listener the same object in one synchronous fan-out, so a room with N connections ran N identical
 * `JSON.stringify` walks over it — 24x the encoding at 64 subscribers and 139x at 1000, for output
 * that is byte-identical. Encoding where the message ARRIVES rather than where it leaves makes it
 * once per publish.
 *
 * This is also why the frame cannot be cached across publishes, which was tried and reverted: a
 * message object mutated between two publishes has the same identity and a different value, so a
 * cache keyed on it sends the stale one. The unit is the PUBLISH, not the message.
 */
interface Fanout {
    connections: Set<ServerWebSocket<SocketData>>
    /** Ends the room subscription when the last connection goes, so an idle room feeds nothing. */
    off: () => void
}

const FANOUT = new Map<Channel<unknown>, Fanout>()

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
    // The prefix as the BROWSER has to ask for it: an app mounted at `/v2` serves `/v2/__abide/**` and
    // does not go on answering the same endpoints at the origin root. Tested against the mounted
    // prefix rather than by stripping first, because "the path was not under the mount" and "the path
    // is not abide's" have to be the same answer here — a root `/__abide/health` is both.
    const base = mountBase()
    if (!url.pathname.startsWith(base)) return undefined
    // Past this line everything — the ids, the refusals, the trace — is in APP space, so an endpoint
    // is named the same wherever the app is served.
    const path = url.pathname.slice(base.length)
    if (!path.startsWith(ABIDE_PREFIX)) return undefined
    // Past this line the request is ABIDE'S, and all of it is served inside one scope — opened here
    // rather than in each lane, so the next `/__abide/*` endpoint does not have to remember to. It is
    // what makes `traceresponse` answerable on every response including the refusals, what gives a
    // socket's `authorize` a `request()` and a `trace()` to ask about, and what makes every
    // module-level `memo` a handler touches belong to this caller and go away with it.
    return serveIfScoped(request, () => served(request, url, path))
}

function served(request: Request, url: URL, path: string): Response | Promise<Response | undefined> {
    if (path.startsWith(SOCKET_PREFIX)) return upgrade(request, url, path)
    if (path === LOGS_PATH) return logs(request)
    if (path === SCHEMA_PATH) return schema(request)
    if (path === HEALTH_PATH) return serveHealth(request)
    if (path === IDENTITY_PATH) return serveIdentity(request)
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
    const ceiling = bodyCeiling(policy)
    if (ceiling !== Infinity) {
        const declared = Number(request.headers.get('content-length') ?? 0)
        if (Number.isFinite(declared) && declared > ceiling) {
            return refuse(`${id} accepts at most ${ceiling} bytes`, 413, headers)
        }
    }

    let args: unknown
    try {
        // Three doors, one args object, and the DECLARED shape reads the two that arrive as text so
        // `?name=42` on a `name: string` is the string a caller meant. A read carries its args in the
        // query, one parameter each; a body carries them as JSON, or as a form in either encoding —
        // which is what the stub sends when an argument is a FILE, and equally what a caller who
        // submitted a form element sends, one entry per argument. A read arrives by that door too,
        // since a file has no text form to put in a URL.
        if (request.method === 'GET') args = decodeQuery(url.searchParams, policy?.input)
        else if (isForm(request)) args = decodeForm(await request.formData(), policy?.input)
        else args = decodeArgs(await request.text())
    } catch {
        return refuse(`${id} was called with arguments it could not decode`, 400, headers)
    }

    return respond(rpc, args, headers)
}

function upgrade(request: Request, url: URL, path: string): Response | Promise<Response | undefined> {
    const id = path.slice(SOCKET_PREFIX.length)
    const stream = SOCKETS.get(id)
    if (stream === undefined) return refuse(`no socket at ${id}`, 404)
    // `dispatch` latches its `server` argument before the prefix test and nothing awaits in between,
    // so by here the latch already holds THIS server whenever the caller named one.
    const target = running.peek<SocketData>()
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
        // No shape: a socket's derived one is its MESSAGE, and the room is what selects the stream.
        room = decodeQuery(url.searchParams, null)
    } catch {
        return refuse(`${id} was subscribed to with a room it could not decode`, 400)
    }
    return authorized(request, target, id, room, policy)
}

async function authorized(
    request: Request,
    server: Server<SocketData>,
    id: string,
    room: unknown,
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
    const data: SocketData = {
        id,
        room,
        channel: null,
        request,
        policy,
    }
    // The upgrade only ADMITS the connection. `open` below is where it selects its room and either
    // starts that room's fan-out or joins it, so a handshake that never opens subscribes to nothing.
    // Bun answers the handshake itself, so a successful upgrade is a request with no response of its own.
    if (server.upgrade(request, { data })) return undefined
    return refuse(`${id} could not upgrade`, 400)
}

function roomFor(stream: AnySocket, room: unknown): Channel<unknown> {
    return room === undefined ? (stream as Channel<unknown>) : stream(room)
}

/** The websocket half of the mount point, handed straight to `Bun.serve({ websocket })`. */
export const websocket = {
    open(connection: ServerWebSocket<SocketData>): void {
        // This is the entire socket transport: one subscribe per ROOM. Everything a channel already
        // does — tail, fan-out, the reactive read, rooms — is untouched by it being remote.
        const stream = SOCKETS.get(connection.data.id)
        // Declared away between the upgrade and the open — a dev reload landing mid-handshake.
        if (stream === undefined) return
        const room = roomFor(stream, connection.data.room)
        connection.data.channel = room
        let fanout = FANOUT.get(room)
        if (fanout === undefined) {
            const connections = new Set<ServerWebSocket<SocketData>>()
            const off = room.subscribe((message) => {
                const frame = JSON.stringify(message)
                for (const listener of connections) listener.send(frame)
            })
            fanout = { connections, off }
            FANOUT.set(room, fanout)
        }
        fanout.connections.add(connection)
    },
    close(connection: ServerWebSocket<SocketData>): void {
        const room = connection.data.channel
        if (room === null) return
        const fanout = FANOUT.get(room)
        if (fanout === undefined) return
        fanout.connections.delete(connection)
        // The last connection out ends the room subscription, and `channel` takes that as the last
        // subscriber leaving and forgets the room itself. A listener called for every publish to
        // send to nobody, and a table of rooms a client can name, are the same leak at two layers.
        if (fanout.connections.size === 0) {
            fanout.off()
            FANOUT.delete(room)
        }
    },
    message(connection: ServerWebSocket<SocketData>, raw: string | Buffer): void | Promise<void> {
        // Narrowed ONCE, here, and handed down: `data.policy` is written at the upgrade and never
        // again, so re-reading it per frame past this gate was a second load and a branch that
        // `accept === false` had already made unreachable.
        const policy = connection.data.policy
        if (policy === undefined) return
        const accept = policy.clientPublish
        // A socket is a broadcast until an app says otherwise: a client that may publish into a room
        // is a client that may write to every subscriber of it.
        if (accept === false) return
        let message: unknown
        try {
            message = JSON.parse(String(raw)) as unknown
        } catch (bad) {
            return dropped(connection, bad)
        }
        const declared = policy.checkMessage ?? null
        if (declared === null) return published(connection, policy, accept, message)
        // Guarded like every other step on this path: a schema over a plain object refuses or passes
        // in the call, and this runs once per inbound message.
        let gated: unknown
        try {
            gated = declared(message)
        } catch (refusal) {
            return dropped(connection, refusal)
        }
        if (!isThenable(gated)) return published(connection, policy, accept, gated)
        return (gated as Promise<unknown>).then(
            (checked) => published(connection, policy, accept, checked),
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
    policy: SocketPolicy,
    accept: (message: unknown, room: unknown, into: Channel<unknown>) => void | Promise<void>,
    message: unknown,
): void | Promise<void> {
    const event: SocketEvent<unknown, unknown> = {
        kind: 'publish',
        room: connection.data.room,
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
    if (!isThenable(ran)) return accepted(connection, accept, message)
    return ran.then(
        () => accepted(connection, accept, message),
        // A refusal is a drop, the same as one thrown synchronously above.
        (refusal: unknown) => dropped(connection, refusal),
    )
}

/**
 * The handler runs, and the operator hears about it.
 *
 * The counterpart to `dropped`: an operator reading `abide:socket` to find out why nothing arrives
 * cannot tell "every frame was refused" from "no frame was sent" when only the refusals are said.
 * BEFORE the handler rather than after, so a publish whose handler throws is still accounted for —
 * the line reports that the frame got through the gates, which is what the channel is answering.
 *
 * Both call sites in `published` — the sync arm and the `then` — funnel here rather than each
 * reading the room and the channel back off the connection.
 */
function accepted(
    connection: ServerWebSocket<SocketData>,
    accept: (message: unknown, room: unknown, into: Channel<unknown>) => void | Promise<void>,
    message: unknown,
): void | Promise<void> {
    if (socketLog.enabled()) socketLog.debug(`${connection.data.id} accepted a client publish`)
    // Written by `open`, and a message cannot arrive before it: the only way past this is the socket
    // having been declared away between the handshake and the frame, and there is nothing to publish
    // into then.
    const room = connection.data.channel
    if (room === null) return
    return accept(message, connection.data.room, room)
}
