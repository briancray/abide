// The DOORS: how a request reaches a declaration. What has been declared is `catalogue.ts`, which
// this reads and the two projections read without reaching back through here.
//
// `dispatch` returns `undefined` for anything outside the reserved prefix, which is what lets an app
// mount it in front of its own routes and never think about it again.

import type { Server, ServerWebSocket } from 'bun'
import type { Channel } from '#shared/channel.ts'
import { reserved } from '#shared/internal/mount.ts'
import {
    ABIDE_PREFIX,
    HEALTH_PATH,
    IDENTITY_PATH,
    LOGS_PATH,
    MCP_PATH,
    OPENAPI_PATH,
    RPC_PREFIX,
    SCHEMA_PATH,
    SOCKET_PREFIX,
    TAIL_PARAM,
    WAIT_PARAM,
} from '#shared/internal/PATHS.ts'
import { isThenable, messageOf } from '#shared/internal/probes.ts'
import { NO_LIMIT } from '#shared/internal/timers.ts'
import { decodeArgs, decodeForm, decodeQuery, isForm } from '#shared/internal/wire.ts'
import { abideLog } from '#shared/log.ts'
import { type AnySocket, endpoints, RPCS, SOCKETS } from './catalogue.ts'
import { config } from './config.ts'
import { serveHealth } from './health.ts'
import { serveIdentity } from './identity.ts'
import { logs } from './logs.ts'
import { headersFor, json, jsonl, refuse } from './responses.ts'
import {
    authorize,
    bodyCeiling,
    policyOf,
    respond,
    type SocketEvent,
    type SocketPolicy,
    socketPolicyOf,
} from './rpc.ts'
import { openapi } from './openapi.ts'
import { server as running } from './running.ts'
import { serveIfScoped } from './scopes.ts'

/**
 * The catalogue as a response. Open, unlike the log feed: every address in it is already in the
 * client bundle, and the shape beside it is the CONTRACT for calling that address — a caller that
 * cannot read it is a caller that gets it wrong and is refused by the same declaration anyway.
 */
function schema(request: Request): Response {
    if (request.method !== 'GET') return refuse('the schema is a GET', 405)
    return json(endpoints())
}

/**
 * The same catalogue as an OpenAPI document, open for the same reason the schema is.
 *
 * Built per request rather than cut once, because `endpoints()` is: a lane registers a module when
 * it is first imported, so a document cached at boot would be missing every endpoint behind a route
 * nobody had asked for yet. It is a walk of a map an app has tens of entries in, on an address a
 * generator reads once.
 */
function described(request: Request): Response {
    if (request.method !== 'GET') return refuse('the openapi document is a GET', 405)
    return json(openapi())
}

/**
 * The MCP surface, behind the origin gate — CLOSED to a cross-origin caller unless one is named.
 *
 * Gated HERE rather than inside `mcp.ts` so the rule and its default are written once, beside the one
 * every rpc gets. It is also the mitigation that transport's own spec asks for by name: a local MCP
 * server that answers any origin is reachable by DNS rebinding from a page the user merely visited,
 * and every tool it publishes is reachable with it.
 *
 * Closed with nothing to open it, where an rpc has `crossOrigin`, and the asymmetry is the point: an
 * ordinary MCP client is a PROCESS rather than a page, so it sends no `Origin` at all and this gate
 * never sees it. The only caller a declared origin would admit is a browser, which is the exact
 * caller the mitigation exists to keep out.
 */
async function tooling(request: Request, url: URL): Promise<Response> {
    const headers = crossOrigin(request, url, null)
    if (headers === null) {
        return refuse(`the mcp surface is not open to ${request.headers.get('origin')}`, 403)
    }
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: headersFor(headers, NO_DEFAULTS) })
    }
    // LAZY, and that is a bundle fact rather than a startup one: `registry.ts` is reached from
    // `abide/server/internal`, which every demo imports for `renderToString`, so a static edge onto
    // this module put the whole MCP projection — 14 kB, mostly protocol strings that minify badly —
    // into the client chunks. An edge is priced by the module it lands on, and nothing else in the
    // tree imports `mcp.ts` at all. What it costs is one dynamic import on an address a tool calls.
    const { mcp } = await import('./mcp.ts')
    return mcp(request, url, headers)
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

// Four of these are fixed at the UPGRADE and carried for the connection's lifetime: the endpoint
// `id`, its `policy`, the `request`, and `room` — which is the decoded QUERY, the args that say which
// room, not the room. `channel` alone is resolved at `open` — see its own comment below for why.
// `message` runs per inbound frame and re-resolves none of them.
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
    // does not go on answering the same endpoints at the origin root. `reserved` is that one answer —
    // "the path was not under the mount" and "the path is not abide's" cannot be two here, because a
    // root `/__abide/health` is both.
    //
    // Past this line everything — the ids, the refusals, the trace — is in APP space, so an endpoint
    // is named the same wherever the app is served.
    const path = reserved(url.pathname, ABIDE_PREFIX)
    if (path === null) return undefined
    // Past this line the request is ABIDE'S, and all of it is served inside one scope — opened here
    // rather than in each lane, so the next `/__abide/*` endpoint does not have to remember to. It is
    // what makes `traceresponse` answerable on every response including the refusals, what gives a
    // socket's `authorize` a `request()` and a `trace()` to ask about, and what makes every
    // module-level `memo` a handler touches belong to this caller and go away with it.
    return serveIfScoped(request, () => served(request, url, path))
}

function served(request: Request, url: URL, path: string): Response | Promise<Response | undefined> {
    // An upgrade NAMES ITSELF, so the same address serves all three doors of one socket — see the
    // section above `overHttp`. A browser sends this header and nothing else does.
    if (path.startsWith(SOCKET_PREFIX)) {
        const wants = request.headers.get('upgrade')
        if (wants !== null && wants.toLowerCase() === 'websocket') return upgrade(request, url, path)
        return overHttp(request, url, path)
    }
    if (path === LOGS_PATH) return logs(request)
    if (path === SCHEMA_PATH) return schema(request)
    if (path === OPENAPI_PATH) return described(request)
    if (path === MCP_PATH) return tooling(request, url)
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

/** One socket address, resolved: the gates both of its doors share, and what they resolved to. */
interface SocketAddress {
    id: string
    stream: AnySocket
    policy: SocketPolicy | undefined
    /** The cross-origin answer. Carried by the HTTP arm; the upgrade has no response to put it on. */
    headers: Record<string, string>
    room: unknown
    /** `TAIL_PARAM` / `WAIT_PARAM` as they arrived, for the one door that bounds a tail. */
    bound: string | null
    waited: string | null
}

/**
 * The socket an address names, with every gate the two doors SHARE already run.
 *
 * One resolver rather than one per door, because the room is the thing they must agree about: a query
 * read by the upgrade as `7` and by the HTTP arm as `"7"` is two rooms, and a publish landing where
 * nobody is listening is the quietest failure there is. Written twice, that agreement was a comment;
 * written once it is the only way to reach either door.
 *
 * The bounds come OFF the query before the room is decoded, for the same reason: everything left on
 * this query string is the ADDRESS, so a bound left in it would make `?room=a&__abide_tail=2` a
 * different room from `?room=a`.
 *
 * A websocket upgrade is not subject to CORS, so the declaration has to gate it here or a page
 * anywhere could open one.
 */
function socketAt(request: Request, url: URL, path: string): SocketAddress | Response {
    const id = path.slice(SOCKET_PREFIX.length)
    const stream = SOCKETS.get(id)
    if (stream === undefined) return refuse(`no socket at ${id}`, 404)
    const policy = socketPolicyOf(stream)
    const headers = crossOrigin(request, url, policy?.crossOrigin ?? null)
    if (headers === null) {
        return refuse(`${id} is not open to ${request.headers.get('origin')}`, 403)
    }
    const bound = url.searchParams.get(TAIL_PARAM)
    const waited = url.searchParams.get(WAIT_PARAM)
    url.searchParams.delete(TAIL_PARAM)
    url.searchParams.delete(WAIT_PARAM)
    let room: unknown
    try {
        // The DECLARED room shape — a socket's `input` is its MESSAGE, and this is the separate
        // derivation that says what ADDRESSES it.
        room = decodeQuery(url.searchParams, policy?.room ?? null)
    } catch {
        return refuse(`${id} was addressed with a room it could not decode`, 400, headers)
    }
    return { id, stream, policy, headers, room, bound, waited }
}

function upgrade(request: Request, url: URL, path: string): Response | Promise<Response | undefined> {
    const at = socketAt(request, url, path)
    if (at instanceof Response) return at
    // `dispatch` latches its `server` argument before the prefix test and nothing awaits in between,
    // so by here the latch already holds THIS server whenever the caller named one.
    const target = running.peek<SocketData>()
    if (target === null) {
        return refuse('a socket needs the Bun server — `dispatch(request, server)`', 500)
    }
    return authorized(request, target, at.id, at.room, at.policy)
}

async function authorized(
    request: Request,
    server: Server<SocketData>,
    id: string,
    room: unknown,
    policy: SocketPolicy | undefined,
): Promise<Response | undefined> {
    if (policy !== undefined) {
        // The same gate the HTTP tail runs, from the same helper: a subscribe admitted by one door and
        // refused by the other would be one socket with two security postures.
        const why = await gateway(policy, { kind: 'subscribe', room, message: undefined, request })
        if (why !== null) return refuse(why.why, why.status)
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

// --- the socket over ordinary http -------------------------------------------
//
// The SAME address as the upgrade, because it is the same endpoint: `GET` with an `Upgrade` header is
// a websocket, `GET` without one is the transcript-then-follow as ndjson, and `POST` is one message
// into the room. A second address would be a second thing to name, secure and keep in step, and it
// would put the two doors of one socket in different places in a generated document.
//
// What it is FOR is everything that cannot hold a websocket: an MCP tool call, a generated OpenAPI
// client, a shell. Those are the same callers that need the tail to END, which is what `TAIL_PARAM`
// is — see its comment. Every gate the frame path runs, this runs; what it does NOT share is the
// silent drop, because that exists for a frame having no response to refuse in and this has one.

function overHttp(request: Request, url: URL, path: string): Response | Promise<Response> {
    const at = socketAt(request, url, path)
    if (at instanceof Response) return at
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: headersFor(at.headers, NO_DEFAULTS) })
    }
    if (request.method === 'GET') return tailed(request, at)
    if (request.method === 'POST') return sent(request, at)
    return refuse(`${at.id} tails on GET and takes a publish on POST`, 405, at.headers)
}

/**
 * What a gate refused, and the status the REQUEST door says it with.
 *
 * A sentinel rather than a throw, because both doors answer a refusal rather than propagating one —
 * and a class rather than a tuple so the happy path allocates nothing: `admitted` hands the message
 * itself back, and a decoded JSON value is never one of these.
 *
 * The frame door reads `why` and drops; only the request door has a response to put `status` in.
 */
class Refusal {
    constructor(
        readonly why: string,
        readonly status: number,
    ) {}
}

/**
 * EVERY GATE BETWEEN A READABLE MESSAGE AND THE HANDLER, IN THE ORDER BOTH DOORS RUN THEM.
 *
 * The declared schema, then the middleware chain — and the message that came out of them, because a
 * gate may REPLACE what it checked. A `Refusal` is one of them refusing.
 *
 * Written once for the two doors, and that is the whole point: they ran the same gates in the same
 * order and what held them in step was a comment on each saying so. A gate added to one left the
 * other open, and nothing went red — each door on its own was still correct. `#shared/demos`'s
 * transport suite now asserts the two AGAINST each other, and this is what makes the assertion
 * structural rather than a thing to remember.
 *
 * What the doors keep is what genuinely differs: where the message came from (`await request.json()`
 * against a `JSON.parse` of a frame), whether `clientPublish` was declared at all, what the room and
 * the channel are, and how a refusal is SAID.
 *
 * Guarded rather than `async`, because the frame path runs this per MESSAGE: the ordinary socket has
 * no middleware and a synchronous schema, and an unconditional promise wrap would cost an allocation
 * and a tick on every inbound frame.
 */
function admitted(
    policy: SocketPolicy,
    message: unknown,
    room: unknown,
    request: Request,
): unknown | Promise<unknown> {
    const declared = policy.checkMessage
    if (declared === null) return chained(policy, message, room, request)
    let gated: unknown
    try {
        gated = declared(message)
    } catch (refusal) {
        return new Refusal(messageOf(refusal), 422)
    }
    if (!isThenable(gated)) return chained(policy, gated, room, request)
    return gated.then(
        (checked) => chained(policy, checked, room, request),
        (refusal: unknown) => new Refusal(messageOf(refusal), 422),
    )
}

/**
 * The socket's own chain, as a refusal rather than a throw — `null` when it let the event through.
 *
 * The one place `authorize` is turned into an answer, for BOTH kinds of event: a subscribe (the
 * upgrade and the HTTP tail) and a publish (the two doors below). A subscribe admitted by one door
 * and refused by another would be one socket with two security postures.
 *
 * Guarded rather than `async`, because the publish arm runs it per FRAME and the ordinary socket has
 * no middleware at all — `authorize` already returns synchronously for an empty chain, and an
 * unconditional promise wrap here would throw that away.
 */
function gateway(
    policy: SocketPolicy,
    event: SocketEvent<unknown, unknown>,
): Refusal | null | Promise<Refusal | null> {
    let ran: void | Promise<void>
    try {
        ran = authorize(policy, event)
    } catch (refusal) {
        return new Refusal(messageOf(refusal), 403)
    }
    if (!isThenable(ran)) return null
    return (ran as Promise<void>).then(
        () => null,
        (refusal: unknown) => new Refusal(messageOf(refusal), 403),
    )
}

/** The last gate before the handler, and the message that came through it. */
function chained(
    policy: SocketPolicy,
    message: unknown,
    room: unknown,
    request: Request,
): unknown | Promise<unknown> {
    const why = gateway(policy, { kind: 'publish', room, message, request })
    if (!isThenable(why)) return why === null ? message : why
    return (why as Promise<Refusal | null>).then((settled) => (settled === null ? message : settled))
}

/**
 * The transcript, then everything published after it, as ndjson.
 *
 * `channel.tail()` is the whole of it — the same generator a local reader iterates, which is what
 * makes this a door onto the socket rather than a second implementation of one. The snapshot and the
 * subscribe happen in one synchronous run in there, so a message published between them is missed by
 * neither, and `jsonl` holds the request scope until the last chunk.
 *
 * The two bounds are handed to `tail` rather than wrapped around it, and that is not tidiness: a
 * generator parked awaiting its next message does not process a `return()` until one arrives, so a
 * bound applied from out here would leave the subscription alive on exactly the quiet rooms it is
 * for. See `TailOptions`.
 */
async function tailed(request: Request, at: SocketAddress): Promise<Response> {
    const { id, stream, policy, headers, room, bound, waited } = at
    if (policy !== undefined) {
        const why = await gateway(policy, { kind: 'subscribe', room, message: undefined, request })
        if (why !== null) return refuse(why.why, why.status, headers)
    }
    const limit = bound === null ? NO_LIMIT : Number(bound)
    if (!(limit > 0)) {
        return refuse(`${id} was tailed with a ${TAIL_PARAM} that is not a count`, 400, headers)
    }
    const idle = waited === null ? NO_LIMIT : Number(waited)
    if (!(idle > 0)) {
        return refuse(`${id} was tailed with a ${WAIT_PARAM} that is not a duration`, 400, headers)
    }
    return jsonl(roomFor(stream, room).tail({ limit, idle }), { headers })
}

/**
 * One message into the room, through every gate the frame path runs.
 *
 * The refusals are STATUSES here where the websocket drops silently, and that is not a second policy:
 * a frame has no response to carry a refusal in, so the drop was the only answer available there.
 * Nothing is disclosed by saying so — whether a socket takes a client publish at all is already in
 * the published catalogue, which is what a generated surface reads to know the arm exists.
 *
 * The gates themselves are `admitted`'s, shared with the frame door: what is left here is reading the
 * message off a REQUEST, and saying a refusal as a status.
 */
async function sent(request: Request, at: SocketAddress): Promise<Response> {
    const { id, stream, policy, headers, room } = at
    if (policy === undefined || policy.clientPublish === false) {
        return refuse(`${id} is a broadcast — it does not take what a client sends`, 405, headers)
    }
    const accept = policy.clientPublish
    let message: unknown
    try {
        message = await request.json()
    } catch {
        return refuse(`${id} takes one JSON message as the body`, 400, headers)
    }

    const checked = await admitted(policy, message, room, request)
    if (checked instanceof Refusal) return refuse(checked.why, checked.status, headers)
    // The room the sender is on, resolved the same way `open` resolves it for a connection — the
    // handler is handed the channel rather than re-selecting it, exactly as `clientPublish` documents.
    const ran = accept(checked, room, roomFor(stream, room))
    if (isThenable(ran)) await ran
    // ACCEPTED rather than "published": what happens to a client's message is `clientPublish`'s to
    // decide, and a handler that transforms it, routes it elsewhere or drops it has still taken it.
    return json({ accepted: true }, { status: 202, headers })
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
    // THE SAME GATES AS `sent`, THROUGH THE SAME `admitted` — what is left here is reading the
    // message off a FRAME, and dropping rather than answering. Guarded rather than awaited, because
    // this runs per frame where `sent` answers one request.
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
        const checked = admitted(policy, message, connection.data.room, connection.data.request)
        // `admitted` answers a refusal rather than throwing one, so there is no rejection arm here.
        if (!isThenable(checked)) return published(connection, accept, checked)
        return (checked as Promise<unknown>).then((settled) => published(connection, accept, settled))
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
        `${connection.data.id} dropped a client publish: ${messageOf(why)}`,
    )
}

/**
 * What `admitted` let through, or what it refused.
 *
 * The counterpart to `dropped`: an operator reading `abide:socket` to find out why nothing arrives
 * cannot tell "every frame was refused" from "no frame was sent" when only the refusals are said.
 * The line goes out BEFORE the handler rather than after, so a publish whose handler throws is still
 * accounted for — it reports that the frame got through the gates, which is what the channel answers.
 */
function published(
    connection: ServerWebSocket<SocketData>,
    accept: (message: unknown, room: unknown, into: Channel<unknown>) => void | Promise<void>,
    checked: unknown,
): void | Promise<void> {
    if (checked instanceof Refusal) return dropped(connection, checked.why)
    if (socketLog.enabled()) socketLog.debug(`${connection.data.id} accepted a client publish`)
    // Written by `open`, and a message cannot arrive before it: the only way past this is the socket
    // having been declared away between the handshake and the frame, and there is nothing to publish
    // into then.
    const room = connection.data.channel
    if (room === null) return
    return accept(checked, connection.data.room, room)
}
