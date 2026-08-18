// The MCP surface: every declaration an app made, as tools an agent can call.
//
// Two things make this small enough to hand-write, and both are decisions taken elsewhere. The shape
// is already JSON Schema — an `inputSchema` IS what `endpoints()` carries, with nothing to convert —
// and the CALL is already served: `tools/call` builds a request to the app's own `/__abide/` door and
// re-enters `dispatch`. So every policy, middleware rung, cross-origin rule, schema gate and refusal
// applies exactly once, in the place that already owned it. An MCP call that bypassed those to reach
// a handler directly would be a second door with a second security posture, which is the failure
// this whole file is arranged to avoid.
//
// No SDK. The transport is JSON-RPC 2.0 over one POST, which is a `switch` over three method names and
// an error table — measurably less code than the adapter a dependency would need, and it keeps the
// package at zero dependencies.
//
// ONE REVISION, `2026-07-28`, and that is what makes the file this size. That revision made MCP
// STATELESS: there is no `initialize` handshake, no session, no `ping` and no batch, so there is no
// connection state to establish, carry or expire — every request states its own version and
// capabilities and is checked on its own. Speaking the handshake era as well would mean two
// validation paths, two result shapes and a version branch on every method, to reach clients that
// this revision already tells how to fall back: an unsupported version comes back naming what abide
// does speak. See `validated` and `mcp`.

import { MCP_PATH, RPC_PREFIX, SOCKET_PREFIX, TAIL_PARAM, WAIT_PARAM } from '#shared/internal/PATHS.ts'
import { messageOf } from '#shared/internal/probes.ts'
import type { EndpointShape, JsonSchema } from '#shared/internal/shapes.ts'
import { argsQuery, chunksOf, errorMessage, isChunked, payloadOf } from '#shared/internal/wire.ts'
import { config } from './config.ts'
import { endpoints } from './catalogue.ts'
import { dispatch } from './registry.ts'
import { json, refuse } from './responses.ts'

/**
 * The revisions this speaks, which is one — see the header. Answered by `server/discover` and checked
 * on every request, because a stateless protocol has nowhere else to have agreed it.
 */
const SUPPORTED_VERSIONS = ['2026-07-28']

// The `_meta` keys the protocol reserves for itself. The prefix is spelled out rather than built,
// because it is a wire constant and a template that produced it would be one more thing to read.
const META_VERSION = 'io.modelcontextprotocol/protocolVersion'
const META_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities'
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo'

/** The sentinel a header value is wrapped in when it will not survive as plain ASCII. */
const BASE64_OPEN = '=?base64?'
const BASE64_CLOSE = '?='

/**
 * How long a client may cache `tools/list` and `server/discover`, in ms.
 *
 * Short, and the reason is the same one that stops this being cut at boot: a lane registers its
 * module when a route is first imported, so the list GROWS over a process's life. There is no
 * `subscriptions/listen` here to announce that, so the freshness hint is the only thing telling a
 * client to look again.
 */
const LIST_TTL_MS = 60_000

/**
 * How many messages a `tail` takes when the caller did not say.
 *
 * A socket never ends, and a tool call must — an agent waiting on a stream that will not close is an
 * agent that has hung. So the bound is DEFAULTED rather than required: the tool stays callable with
 * no arguments, and what it answers with is a window rather than a promise nobody can keep.
 */
const DEFAULT_TAIL = 16

/**
 * ms a `tail` waits for the next message before answering with what it has.
 *
 * The count alone is not enough, and this is the half that makes the tool honest: a room that is
 * simply quiet never reaches the count, so an agent would wait on a stream nobody is writing to. With
 * both, an idle room answers empty — which is an ANSWER, and something an agent can reason about.
 */
const DEFAULT_WAIT = 1_000

/** Which of an endpoint's doors one tool stands for. A socket has two; an rpc is the call itself. */
type Arm = 'call' | 'tail' | 'publish'

interface Target {
    endpoint: EndpointShape
    arm: Arm
}

interface ToolDefinition {
    name: string
    title: string
    description: string
    inputSchema: JsonSchema
    outputSchema?: JsonSchema
}

/** One JSON-RPC call. `id` absent is a NOTIFICATION, which by the spec is answered with nothing. */
interface Call {
    jsonrpc?: unknown
    id?: string | number | null
    method?: unknown
    params?: Record<string, unknown>
}

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603
// MCP's own, from the range the spec reserves for itself (`-32020` to `-32099`). The older codes in
// `-32000`..`-32019` are implementation-defined and this revision forbids emitting them.
const HEADER_MISMATCH = -32020
const UNSUPPORTED_VERSION = -32022

/**
 * An abide address as a name a tool client will accept.
 *
 * `users/getUser` is the address, and a slash is not in the character class the LLM APIs that consume
 * these tools enforce — so it is replaced rather than passed through, and the true address is kept in
 * `title` and stated in the description. This is the one place abide renames something across a seam,
 * and it is a client constraint rather than a choice: a tool named for its address is a tool those
 * clients reject outright.
 *
 * Collisions are resolved by the CALLER below rather than here, because two endpoints only collide in
 * the context of the whole list — see `catalogue`.
 */
function nameFor(id: string, arm: Arm): string {
    const safe = id.replace(/[^A-Za-z0-9_-]/g, '_')
    return arm === 'call' ? safe : `${safe}_${arm}`
}

/** An object schema built for a tool, where every tool's input has to be one. */
function objectSchema(properties: Record<string, JsonSchema>, required: string[]): JsonSchema {
    return { type: 'object', properties, required }
}

/**
 * A socket's arms take the room NESTED under one member rather than spread beside the rest.
 *
 * Spread, a room whose own shape has a member called `message` or `limit` would collide with the
 * argument beside it and one of the two would silently win. Nested, there is nothing to collide —
 * and the agent reads a shape that says which half is the address and which is the payload, which is
 * the distinction it most needs to get right.
 */
function socketInput(endpoint: EndpointShape, arm: 'tail' | 'publish'): JsonSchema {
    const properties: Record<string, JsonSchema> = {}
    const required: string[] = []
    if (endpoint.room !== undefined) {
        properties.room = endpoint.room
        required.push('room')
    }
    if (arm === 'tail') {
        properties.limit = {
            type: 'integer',
            minimum: 1,
            description: `How many messages to take before answering. Defaults to ${DEFAULT_TAIL}.`,
        }
        properties.wait = {
            type: 'integer',
            minimum: 1,
            description:
                'ms to wait for the next message before answering with what arrived. Defaults to ' +
                `${DEFAULT_WAIT}, so a quiet room answers empty rather than hanging.`,
        }
    } else {
        properties.message = endpoint.input ?? {}
        required.push('message')
    }
    return objectSchema(properties, required)
}

/**
 * Whether this arm answers something `structuredContent` may carry.
 *
 * Asked by the LIST and by the CALL, so the two cannot drift: `outputSchema` is a promise that the
 * answer validates against it, and a client handed `structuredContent` the definition never promised
 * refuses the result. Only an OBJECT output, because that is what the field must be — an rpc
 * answering an array or a scalar would break the promise on every call.
 */
function isStructured(endpoint: EndpointShape, arm: Arm): boolean {
    return arm === 'call' && endpoint.output?.type === 'object'
}

function definitionFor(endpoint: EndpointShape, arm: Arm, name: string): ToolDefinition {
    if (arm === 'call') {
        const definition: ToolDefinition = {
            name,
            title: endpoint.id,
            description:
                (endpoint.description ?? `Call ${endpoint.id}.`) +
                (endpoint.streams === true ? ' Answers as a sequence of chunks.' : ''),
            inputSchema: endpoint.input ?? objectSchema({}, []),
        }
        const output = endpoint.output
        if (output !== undefined && isStructured(endpoint, arm)) definition.outputSchema = output
        return definition
    }
    if (arm === 'tail') {
        return {
            name,
            title: `${endpoint.id} (tail)`,
            description:
                `Read messages from the ${endpoint.id} socket — the transcript it retains, then ` +
                'whatever arrives next, up to the limit given.',
            inputSchema: socketInput(endpoint, 'tail'),
        }
    }
    return {
        name,
        title: `${endpoint.id} (publish)`,
        description:
            `Publish one message into the ${endpoint.id} socket. What happens to it is the socket's ` +
            'own policy to decide, so this reports that the message was ACCEPTED rather than sent on.',
        inputSchema: socketInput(endpoint, 'publish'),
    }
}

/**
 * Every tool NAME, and what each one resolves back to.
 *
 * Built per request rather than cut once, for the reason the OpenAPI document is: a lane registers a
 * module when it is first imported, so a list cached at boot would be missing every endpoint behind a
 * route nobody had asked for yet.
 *
 * Names only, because that is all `tools/call` needs — the definitions are `tools/list`'s alone, and
 * building them here would mean every tool call assembled a description per endpoint to throw away.
 *
 * The dedupe is over the WHOLE list because that is the only place a collision exists: `a/b` and `a-b`
 * both sanitise to `a_b`, and so does an rpc called `a_b` that never needed sanitising at all. The
 * later name gains a counter, and "later" is stable because `endpoints()` is sorted — so two runs of
 * one app produce the same tool list, which is what lets an agent's cached list stay correct.
 */
function targetsOf(): Map<string, Target> {
    const targets = new Map<string, Target>()
    for (const endpoint of endpoints()) {
        if (!endpoint.clients.mcp) continue
        const arms: Arm[] =
            endpoint.kind === 'rpc' ? ['call'] : endpoint.clientPublish === true ? ['tail', 'publish'] : ['tail']
        for (const arm of arms) {
            let name = nameFor(endpoint.id, arm)
            if (targets.has(name)) {
                let counter = 2
                while (targets.has(`${name}_${counter}`)) counter++
                name = `${name}_${counter}`
            }
            targets.set(name, { endpoint, arm })
        }
    }
    return targets
}

/**
 * The address of one of abide's own endpoints, in BROWSER space, derived from the address this
 * request arrived at.
 *
 * Taken off the incoming URL rather than rebuilt from the mount, because the incoming one already
 * carries whatever prefix reached this process — a sub-path mount, and a proxy that rewrote it. A
 * path assembled from `mountBase()` would be right in the ordinary case and quietly wrong behind the
 * one deployment a mount exists for.
 */
function sibling(url: URL, prefix: string, id: string): URL {
    const at = url.pathname.lastIndexOf(MCP_PATH)
    const base = at < 0 ? '' : url.pathname.slice(0, at)
    const next = new URL(url.href)
    next.pathname = `${base}${prefix}${id}`
    next.search = ''
    return next
}

/**
 * The headers a re-entered call carries over from the MCP request.
 *
 * Cookies and `authorization` above all: an app's auth middleware reads those, and a tool call that
 * dropped them would reach every handler as an anonymous caller — which either breaks the call or,
 * far worse, succeeds at an endpoint that should have refused it. `content-type` is set by the door
 * below rather than copied, because the body is this file's to frame.
 */
function carried(request: Request): Headers {
    const headers = new Headers()
    for (const name of ['cookie', 'authorization', 'accept-language', 'user-agent']) {
        const value = request.headers.get(name)
        if (value !== null) headers.set(name, value)
    }
    return headers
}

/** What one arm's request looks like. The room goes through the CLIENT's own encoder — see below. */
function requestFor(request: Request, url: URL, target: Target, args: Record<string, unknown>): Request {
    const { endpoint, arm } = target
    const headers = carried(request)
    // Every arm but the tail carries a body, and the tail is the only GET.
    if (arm !== 'tail') headers.set('content-type', 'application/json')
    if (arm === 'call') {
        // Always a POST, including for a read. The door accepts one — a read falls back to POST when
        // its args are too long for a URL — and it means the arguments travel as JSON rather than
        // being spent through the query encoder and read back, which is a round trip that can only
        // lose. A file cannot travel this way, and cannot travel through a tool call either.
        return new Request(sibling(url, RPC_PREFIX, endpoint.id).href, {
            method: 'POST',
            headers,
            body: JSON.stringify(args ?? {}),
        })
    }
    const address = sibling(url, SOCKET_PREFIX, endpoint.id)
    // `argsQuery` is what a browser client encodes a room with, so this arm addresses the SAME room
    // a subscriber does. Spelling the query here instead would be a second encoder, and the failure
    // would be a publish landing in a room nobody is listening to — silent at both ends.
    const room = args.room
    if (room !== undefined) address.search = argsQuery(room)
    if (arm === 'tail') {
        const limit = typeof args.limit === 'number' ? args.limit : DEFAULT_TAIL
        const wait = typeof args.wait === 'number' ? args.wait : DEFAULT_WAIT
        address.searchParams.set(TAIL_PARAM, String(limit))
        // Always set, unlike the HTTP arm's default of waiting forever: a tool call has to return.
        address.searchParams.set(WAIT_PARAM, String(wait))
        return new Request(address.href, { method: 'GET', headers })
    }
    return new Request(address.href, { method: 'POST', headers, body: JSON.stringify(args.message ?? null) })
}

/**
 * A framed body as its messages, anything else as the one value it carries.
 *
 * The wire's own reader rather than a second one: `isChunked` knows all three framings a handler can
 * answer in — the rpc's ndjson, `jsonl()` and `sse()` — where a decoder written here would have to be
 * taught each of them again, and the one it missed would reach the agent as raw text. `payloadOf` is
 * the same rule for the unframed arm, binary included.
 */
async function answerOf(id: string, response: Response): Promise<unknown> {
    if (!isChunked(response)) return payloadOf(response)
    const messages: unknown[] = []
    for await (const message of chunksOf(id, response)) messages.push(message)
    return messages
}

/**
 * A tool result, in the two shapes a client may read it in.
 *
 * `content` is the one every client understands and is therefore never omitted; `structuredContent`
 * is set only where the tool declared an `outputSchema`, because a client that validates one against
 * the other will refuse a result that carries the second without the first having promised it.
 */
function resultOf(value: unknown, structured: boolean): Record<string, unknown> {
    const result: Record<string, unknown> = {
        content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    }
    if (structured && value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result.structuredContent = value
    }
    return result
}

/** A refusal an AGENT reads, which is a result rather than a protocol error — see `called`. */
function toolFailure(message: string): Record<string, unknown> {
    return { content: [{ type: 'text', text: message }], isError: true }
}

async function called(
    request: Request,
    url: URL,
    params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const name = params.name
    if (typeof name !== 'string') throw new RpcError(INVALID_PARAMS, 'tools/call needs a tool name', 400)
    const target = targetsOf().get(name)
    if (target === undefined) throw new RpcError(INVALID_PARAMS, `there is no tool called ${name}`, 400)
    const args = (params.arguments ?? {}) as Record<string, unknown>
    if (target.arm === 'publish' && args.message === undefined) {
        return toolFailure(`${name} needs a message to publish`)
    }
    const answered = await dispatch(requestFor(request, url, target, args))
    if (answered === undefined) {
        // `dispatch` hands back nothing only for a path outside the reserved prefix, which cannot
        // happen for an address this file built — so it is a bug here rather than a caller's fault.
        throw new RpcError(INTERNAL_ERROR, `${name} did not reach an abide endpoint`, 500)
    }
    let value: unknown
    try {
        value = await answerOf(name, answered)
    } catch (failure) {
        // A body that failed PART WAY: `chunksOf` throws on the failure frame the writer ends with.
        // An agent can act on that message, so it lands as a result for the reason a refusal does.
        return toolFailure(messageOf(failure))
    }
    // A REFUSAL IS A RESULT, not a JSON-RPC error. The protocol's errors are about the protocol —
    // a method that does not exist, params that are not readable — and an agent that gets one has no
    // way to act on it. A 422 from a schema gate is something the agent can fix by calling again with
    // better arguments, so it comes back as `isError` with the message, inside a well-formed result.
    if (!answered.ok) {
        return toolFailure(errorMessage(value) || `${name} failed with ${answered.status}`)
    }
    return resultOf(value, isStructured(target.endpoint, target.arm))
}

/**
 * A protocol failure, with the HTTP status this revision requires for it.
 *
 * The status is part of the error rather than chosen at the end because the spec fixes it per case
 * and not per layer: a header that does not match the body is `400`, a method that does not exist is
 * `404`, and an ordinary application error is `200` carrying a JSON-RPC error like any other answer.
 * A client uses that status to tell a modern server from a legacy one before it reads the body.
 */
class RpcError extends Error {
    constructor(
        readonly code: number,
        message: string,
        readonly status: number,
        readonly data: unknown = undefined,
    ) {
        super(message)
        this.name = 'AbideMcpError'
    }
}

/**
 * A header value that may have arrived Base64-wrapped.
 *
 * A tool name is only SHOULD-constrained to header-safe characters, so the transport defines a
 * sentinel for the ones that are not — and a server comparing the raw header against the body would
 * reject exactly the names the sentinel exists to carry.
 */
function headerValue(raw: string): string {
    if (!raw.startsWith(BASE64_OPEN) || !raw.endsWith(BASE64_CLOSE)) return raw
    const encoded = raw.slice(BASE64_OPEN.length, raw.length - BASE64_CLOSE.length)
    try {
        return new TextDecoder().decode(Uint8Array.fromBase64(encoded))
    } catch {
        // Not decodable is not a match — the comparison below refuses it, which is what the spec asks
        // for on a malformed header value.
        return raw
    }
}

/**
 * Everything the transport requires of a request before any method sees it.
 *
 * All of it is per REQUEST, because this revision made the protocol stateless: there is no handshake
 * to have settled the version and no session to carry the client's capabilities, so each call states
 * both and each call is checked. That is what makes the mirrored headers meaningful — an intermediary
 * routes on `Mcp-Method` while this executes on the body, and a server that never compared the two
 * would let those disagree, which is the vulnerability the mirroring introduces if unchecked.
 */
function validated(request: Request, call: Call): void {
    if (call.jsonrpc !== '2.0' || typeof call.method !== 'string') {
        throw new RpcError(INVALID_REQUEST, 'a call is `{ jsonrpc: "2.0", id, method }`', 400)
    }
    const method = call.method
    const saidMethod = request.headers.get('mcp-method')
    if (saidMethod === null) {
        throw new RpcError(HEADER_MISMATCH, 'every call carries an `Mcp-Method` header', 400)
    }
    if (saidMethod !== method) {
        throw new RpcError(HEADER_MISMATCH, `Mcp-Method says ${saidMethod} and the body says ${method}`, 400)
    }
    const saidVersion = request.headers.get('mcp-protocol-version')
    if (saidVersion === null) {
        throw new RpcError(HEADER_MISMATCH, 'every call carries an `MCP-Protocol-Version` header', 400)
    }
    const meta = (call.params?._meta ?? {}) as Record<string, unknown>
    const version = meta[META_VERSION]
    if (typeof version !== 'string') {
        throw new RpcError(INVALID_PARAMS, `every call carries \`${META_VERSION}\` in \`_meta\``, 400)
    }
    if (saidVersion !== version) {
        throw new RpcError(
            HEADER_MISMATCH,
            `MCP-Protocol-Version says ${saidVersion} and the body says ${version}`,
            400,
        )
    }
    if (!SUPPORTED_VERSIONS.includes(version)) {
        throw new RpcError(UNSUPPORTED_VERSION, `abide does not speak MCP ${version}`, 400, {
            supported: SUPPORTED_VERSIONS,
            requested: version,
        })
    }
    if (meta[META_CAPABILITIES] === undefined) {
        throw new RpcError(INVALID_PARAMS, `every call carries \`${META_CAPABILITIES}\` in \`_meta\``, 400)
    }
    // Required for this method alone, which is why it is not up with the other two.
    if (method === 'tools/call') {
        const saidName = request.headers.get('mcp-name')
        if (saidName === null) {
            throw new RpcError(HEADER_MISMATCH, 'a tools/call carries an `Mcp-Name` header', 400)
        }
        const name = call.params?.name
        if (headerValue(saidName) !== name) {
            throw new RpcError(HEADER_MISMATCH, `Mcp-Name does not match the tool named in the body`, 400)
        }
    }
}

/** Who answered. Self-reported and for display only, which is why nothing here reads it back. */
function serverInfo(): Record<string, unknown> {
    const settings = config()
    return { name: settings.APP_NAME, version: settings.APP_VERSION }
}

/**
 * The two members every result carries, stamped in ONE place.
 *
 * `resultType` is required on every result in this revision — it is what lets a client tell a final
 * answer from an interim one asking for input — and a method that forgot it would be read as a
 * malformed result rather than as the answer it is.
 */
function completed(result: Record<string, unknown>): Record<string, unknown> {
    result.resultType = 'complete'
    result._meta = { [META_SERVER_INFO]: serverInfo() }
    return result
}

function answer(request: Request, url: URL, call: Call): Promise<Record<string, unknown>> | Record<string, unknown> {
    const method = call.method
    const params = (call.params ?? {}) as Record<string, unknown>
    if (method === 'server/discover') {
        return {
            supportedVersions: SUPPORTED_VERSIONS,
            // Tools and nothing else: an app's declarations are calls, and neither `resources` nor
            // `prompts` has anything to hold that `tools` does not already say better. `listChanged`
            // is false because there is no `subscriptions/listen` here to deliver one on.
            capabilities: { tools: { listChanged: false } },
            instructions:
                'Every tool here is one endpoint an app declared. A name ending in `_tail` reads a ' +
                'socket and one ending in `_publish` writes to it; everything else is a call.',
            ttlMs: LIST_TTL_MS,
            cacheScope: 'public',
        }
    }
    if (method === 'tools/list') {
        const tools: ToolDefinition[] = []
        for (const [name, target] of targetsOf()) tools.push(definitionFor(target.endpoint, target.arm, name))
        // `cacheScope: 'public'` because this list does NOT vary by caller: it is the whole catalogue,
        // the same one `/__abide/schema` serves openly, and an endpoint an app wanted kept back is
        // already out of it by `clients: { mcp: false }` rather than by who is asking.
        return { tools, ttlMs: LIST_TTL_MS, cacheScope: 'public' }
    }
    if (method === 'tools/call') return called(request, url, params)
    throw new RpcError(METHOD_NOT_FOUND, `abide's mcp surface has no ${String(method)}`, 404)
}

/**
 * The MCP endpoint: ONE JSON-RPC request per POST.
 *
 * The cross-origin gate is NOT here — `registry.ts` runs it in front, with the same rule and the same
 * closed default every other endpoint gets. That matters more than the tidiness: this transport's own
 * spec calls out DNS rebinding as the attack a local MCP server is exposed to, and the answer to it
 * is exactly the origin check abide already had.
 *
 * What an OLDER client sends and this does not answer: a batch (removed in 2025-06-18), the
 * `initialize` handshake and `ping` (removed here, along with the state they existed to set up), a
 * `GET` opening a standalone stream and a `DELETE` ending a session (both removed with sessions).
 * `Mcp-Session-Id` and `Last-Event-ID` are ignored rather than echoed, which is what the revision says
 * to do with them. Such a client gets `UnsupportedProtocolVersionError` naming what abide does speak,
 * which is the fallback signal the spec defines — a silent 400 would read as a legacy server instead.
 */
export async function mcp(request: Request, url: URL, headers: Record<string, string>): Promise<Response> {
    if (request.method !== 'POST') {
        return refuse('the mcp endpoint takes one JSON-RPC request per POST', 405, headers)
    }
    let body: unknown
    try {
        body = await request.json()
    } catch {
        return failure(null, new RpcError(PARSE_ERROR, 'the body is not JSON', 400), headers)
    }
    if (Array.isArray(body)) {
        const why = 'this revision takes one call per POST — JSON-RPC batching is not part of MCP'
        return failure(null, new RpcError(INVALID_REQUEST, why, 400), headers)
    }
    const call = body as Call
    const id = call.id
    // A NOTIFICATION is answered with a status and no body. This revision defines none a client may
    // send over HTTP, so nothing below ever runs for one — but accepting it is what the transport
    // says to do, and it is one branch against a client that sends one anyway.
    if (id === undefined || id === null) return new Response(null, { status: 202, headers })
    try {
        validated(request, call)
        const result = await answer(request, url, call)
        return json({ jsonrpc: '2.0', id, result: completed(result) }, { headers })
    } catch (thrown) {
        return failure(id, thrown, headers)
    }
}

/** A JSON-RPC error, at the status the spec fixes for it. Anything unexpected is ours, so it is 500. */
function failure(id: string | number | null, thrown: unknown, headers: Record<string, string>): Response {
    const known = thrown instanceof RpcError
    const code = known ? thrown.code : INTERNAL_ERROR
    const status = known ? thrown.status : 500
    const error: Record<string, unknown> = {
        code,
        message: messageOf(thrown),
    }
    if (known && thrown.data !== undefined) error.data = thrown.data
    return json({ jsonrpc: '2.0', id, error }, { status, headers })
}
