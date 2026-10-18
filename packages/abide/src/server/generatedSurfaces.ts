// SECTION 20 — WHAT IS GENERATED OFF THE ROUTE TABLE: the OpenAPI document and the MCP endpoint. Each
// is derived from the handlers the app mounted (20.1) and none is authored beside them; each is open
// exactly where the route table lists a handler for it, and a closed one is a 404 (20.7, 36.7).
//
// THE SURFACES ANSWER INSIDE THE APP'S OWN MIDDLEWARE (20.8), because they are answered from the one
// request path everything under `/__abide` is — and a tool call is a request through it again (20.10).
//
// WHAT EACH SURFACE LISTS, AND AS WHAT, is `surfaceOf`'s — the command line's listing reads it too —
// and the MCP protocol is `McpSurface`'s alone, whoever frames it: this endpoint over http, or a
// provider that speaks MCP itself (`assistant`'s `forwardOf`).
//
// WHAT ONLY THE TYPE SAYS IS THE BUILD'S, arriving here on the mount: 16.37's default of `mcp` and
// `cli` to false for a handler returning a `Response`, 20.4's `ui: false`, and 20.11's type-derived
// schema (19.9) as `argsDocument`.

import { isFailed } from '#shared/Failed.ts'
import { namedLogger } from '#shared/log.ts'
import { type Reactive, reactive } from '#shared/reactive/index.ts'
import { parseRoutePattern } from '#shared/routePattern.ts'
import { argsInURL, rpcRequest } from '#shared/rpcRequest.ts'
import { answered } from './answerFailure.ts'
import { bodyWithin, type Mounted } from './answerRpc.ts'
import type { ToolDefinition } from './assistant.ts'
import { appIdentity } from './config.ts'
import { crossingOrigin, crossingRefusal } from './crossingOrigin.ts'
import { MCP_PROTOCOL_VERSION } from './MCP_PROTOCOL_VERSION.ts'
import { type Listed, surfaceOf } from './surfaceOf.ts'

const OPENAPI_LOG = namedLogger('abide:openapi')
const MCP_LOG = namedLogger('abide:mcp')

// What OpenAPI adds to a listing: whether the handler is keyed.
type Published = Listed & { keyed: boolean }

/** Every handler `surface` lists (`surfaceOf`). */
function listed(
    handlers: Map<string, Mounted>,
    surface: 'openapi' | 'mcp',
): Published[] {
    const found: Published[] = []
    for (const mounted of handlers.values()) {
        const one = surfaceOf(mounted, surface)
        if (one === undefined) {
            if (surface === 'mcp') MCP_LOG.debug('withheld', mounted.address)
            continue
        }
        found.push({
            ...one,
            keyed: mounted.handler.keyed,
        })
    }
    return found
}

/**
 * A refusal's shape in the OpenAPI document: RFC 9457's members, and `data` as abide's extension.
 *
 * 15.1 — `type` is the refusal's name, or `about:blank` for an undeclared one.
 */
const PROBLEM_SCHEMA = {
    type: 'object',
    required: ['type', 'title', 'status', 'detail'],
    properties: {
        type: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'integer' },
        detail: { type: 'string' },
        data: {},
    },
}

/** `schema` without the members the path carries, or `schema` itself where it carries none. */
function withoutMembers(
    schema: { properties?: Record<string, unknown>; required?: string[] },
    names: Set<string>,
): unknown {
    if (names.size === 0 || schema.properties === undefined) return schema
    const properties: Record<string, unknown> = {}
    for (const name in schema.properties)
        if (!names.has(name)) properties[name] = schema.properties[name]
    const required: string[] = []
    for (const name of schema.required ?? [])
        if (!names.has(name)) required.push(name)
    return { ...schema, properties, required }
}

/** The OpenAPI 3.1 document, each handler's `JsonSchema` published as it stands. 20.6. */
function openApiOf(handlers: Map<string, Mounted>): {
    openapi: string
    info: { title: string; version: string }
    paths: Record<string, Record<string, unknown>>
} {
    const paths: Record<string, Record<string, unknown>> = {}
    for (const each of listed(handlers, 'openapi')) {
        const operation: Record<string, unknown> = {
            operationId: each.name,
            responses: {
                '200': {
                    description: 'The value.',
                    // 20.15 — what the handler answers, where its type says (19.21).
                    content: {
                        'application/json':
                            each.result === undefined
                                ? {}
                                : { schema: each.result },
                    },
                },
                '204': { description: 'Nothing to say.' },
                default: {
                    description: 'A refusal, as Problem Details (RFC 9457).',
                    content: {
                        'application/problem+json': { schema: PROBLEM_SCHEMA },
                    },
                },
            },
        }
        if (each.description !== undefined)
            operation.description = each.description
        if (each.keyed && each.schema === undefined)
            OPENAPI_LOG.warning(
                `${each.address} has no JSON Schema to publish for its args.`,
            )
        // 16.65 — a route's parameters are the path's, whatever the method, published with or
        // without a schema to type them. OpenAPI has no optional path parameter, so an optional or
        // rest segment is published present and says it may be left out (30.4, 30.5).
        const schema = each.schema as
            | { properties?: Record<string, unknown>; required?: string[] }
            | undefined
        const inPath = new Set<string>()
        const parameters: unknown[] = []
        for (const segment of parseRoutePattern(each.address)) {
            if (segment.kind === 'static') continue
            inPath.add(segment.name)
            const parameter: Record<string, unknown> = {
                name: segment.name,
                in: 'path',
                required: true,
                schema: schema?.properties?.[segment.name] ?? {
                    type: 'string',
                },
            }
            if (segment.kind === 'optional')
                parameter.description = 'May be left out, with its segment.'
            else if (segment.kind === 'rest')
                parameter.description =
                    'The rest of the path, any number of segments, and may be left out with its segment.'
            parameters.push(parameter)
        }
        const queried = schema !== undefined && argsInURL(each.method)
        if (queried) {
            const properties = schema.properties ?? {}
            const required = new Set(schema.required ?? [])
            for (const [name, member] of Object.entries(properties))
                if (!inPath.has(name))
                    parameters.push({
                        name,
                        in: 'query',
                        required: required.has(name),
                        schema: member,
                    })
        }
        if (parameters.length > 0) operation.parameters = parameters
        if (schema !== undefined && !queried)
            operation.requestBody = {
                required: true,
                content: {
                    'application/json': {
                        schema: withoutMembers(schema, inPath),
                    },
                },
            }
        // OpenAPI spells a parameter `{id}` where a route spells it `[id]`.
        const path = each.address.replace(/\[+(?:\.\.\.)?([^\]]+)\]+/g, '{$1}')
        paths[path] ??= {}
        ;(paths[path] as Record<string, unknown>)[each.method.toLowerCase()] =
            operation
    }
    const { name, version } = appIdentity()
    return {
        openapi: '3.1.0',
        info: { title: name, version },
        paths,
    }
}

/**
 * A surface built by `build` over the route table, as a `reactive` cached in `built`.
 *
 * 20.5 — FROM A `reactive` OVER THE ROUTE TABLE, with no `ttl`: the table is fixed for the life of
 * the app, so each surface is built once and served thereafter. A surface's own cache, so an app
 * that opens one does not build the other.
 */
function overTable<Built>(
    built: WeakMap<Map<string, Mounted>, Reactive<Built>>,
    handlers: Map<string, Mounted>,
    build: (handlers: Map<string, Mounted>) => Built,
): Reactive<Built> {
    let found = built.get(handlers)
    if (found === undefined) {
        found = reactive(() => build(handlers), {
            global: true,
        }) as unknown as Reactive<Built>
        built.set(handlers, found)
    }
    return found
}

const documents = new WeakMap<
    Map<string, Mounted>,
    Reactive<ReturnType<typeof openApiOf>>
>()

/** The OpenAPI document over the route table, or `undefined` where it lists no handler. 20.7. */
export function openApi(
    handlers: Map<string, Mounted>,
): Reactive<unknown> | undefined {
    const document = overTable(documents, handlers, openApiOf)
    return Object.keys(document().paths).length > 0 ? document : undefined
}

const published = new WeakMap<Map<string, Mounted>, Reactive<Published[]>>()

type JsonRpc = {
    jsonrpc: '2.0'
    id?: number | string | null
    method: string
    params?: Record<string, unknown>
}

/** An MCP request answered as JSON-RPC's `result` or `error`, without the envelope. */
export type McpReply =
    | { result: unknown; error?: undefined }
    | { result?: undefined; error: { code: number; message: string } }

/** JSON-RPC's `error`. */
export function mcpFailure(code: number, message: string): McpReply {
    return { error: { code, message } }
}

/**
 * The app's MCP surface: what it publishes off the route table, and the protocol answered over it.
 *
 * ONE PER APP, held by every scope that app answers (`AnsweringApp`), so the endpoint, a `Toolbox`
 * and a bridge's Claude Code all answer from it in process — the JSON-RPC envelope is only the
 * endpoint's to frame. A call is still a request through the app's own `fetch`, so its rungs run
 * and refuse as they would for anyone (20.10), and in the app it was made to (42.12).
 */
export class McpSurface {
    readonly #handlers: Map<string, Mounted>
    readonly #answer: (request: Request) => Promise<Response>

    constructor(
        handlers: Map<string, Mounted>,
        answer: (request: Request) => Promise<Response>,
    ) {
        // 20.20 — a tool's arguments are an object, so args that can never be one are no tool.
        for (const mounted of handlers.values()) {
            const tool = surfaceOf(mounted, 'mcp')
            if (tool !== undefined && toolInput(tool.schema) === undefined)
                throw new Error(
                    `abide: ${tool.name}'s args can never be an object, which is all an MCP tool is called with — give it object args, or \`clients: { mcp: false }\`. RULEBOOK 20.20.`,
                )
        }
        this.#handlers = handlers
        this.#answer = answer
    }

    /** Whether the route table publishes any handler to it. 20.7. */
    get opened(): boolean {
        return this.#published().length > 0
    }

    #published(): Published[] {
        // Every handler the MCP surface lists, each a tool — a read as much as a mutation. 20.9.
        return overTable(published, this.#handlers, (handlers) =>
            listed(handlers, 'mcp'),
        )()
    }

    /** Every tool it lists. 20.9. */
    list(): ToolDefinition[] {
        const listing: ToolDefinition[] = []
        for (const tool of this.#published()) {
            if (tool.description === undefined)
                MCP_LOG.warning(
                    `${tool.name} is published with no description.`,
                )
            listing.push({
                name: tool.name,
                description: tool.description ?? '',
                inputSchema: toolInput(tool.schema),
                // 20.14 — what the method promises: a `GET` is safe, and a `GET`, a `PUT` and a
                // `DELETE` idempotent. Any other write may destroy, and nothing says it does not.
                annotations: {
                    readOnlyHint: tool.method === 'GET',
                    destructiveHint: tool.method !== 'GET',
                    idempotentHint:
                        tool.method === 'GET' ||
                        tool.method === 'PUT' ||
                        tool.method === 'DELETE',
                },
                outputSchema: structured(tool) ? tool.result : undefined,
            })
        }
        return listing
    }

    /** What calling the tool `name` as `asker` answered, a refusal or a missing tool a failed one. */
    call(
        name: string,
        args: unknown,
        asker: Request,
    ): Promise<{ text: string; failed: boolean }> {
        const tool = this.#tool(name)
        if (tool === undefined) {
            logCall(String(name), 404, undefined)
            return Promise.resolve({
                text: `No tool named ${name}.`,
                failed: true,
            })
        }
        return this.#called(tool, args as Record<string, unknown>, asker)
    }

    #tool(name: unknown): Published | undefined {
        return this.#published().find((one) => one.name === name)
    }

    async #called(
        one: Published,
        args: Record<string, unknown> | undefined,
        asker: Request,
    ): Promise<{ text: string; failed: boolean }> {
        // 28.7 — a closed namespace does not pay for the line it would have written.
        const started = MCP_LOG.enabled() ? performance.now() : undefined
        let answer: Response
        try {
            answer = await this.#answer(callOf(asker, one, args))
        } catch (thrown) {
            // 15.8 — a path parameter no address carries, refused as the wire's 422 is (`rpcRequest`).
            if (!isFailed(thrown)) {
                logCall(one.name, 500, started)
                throw thrown
            }
            answer = answered(thrown)
        }
        // The body is the call's too: a handler that streams has only begun when its head arrives.
        const text = await answer.text()
        logCall(one.name, answer.status, started)
        return { text, failed: answer.status >= 400 }
    }

    /** One MCP request, made as `asker`, as JSON-RPC's `result` or `error`. */
    async answer(
        method: string,
        params: Record<string, unknown> | undefined,
        asker: Request,
    ): Promise<McpReply> {
        switch (method) {
            case 'initialize':
                return {
                    result: {
                        protocolVersion: MCP_PROTOCOL_VERSION,
                        capabilities: { tools: {} },
                        serverInfo: appIdentity(),
                    },
                }
            case 'ping':
                return { result: {} }
            case 'tools/list':
                return { result: { tools: this.list() } }
            case 'tools/call': {
                const tool = this.#tool(params?.name)
                if (tool === undefined) {
                    logCall(String(params?.name), 404, undefined)
                    return mcpFailure(
                        -32602,
                        `No tool named ${String(params?.name)}.`,
                    )
                }
                const { text, failed } = await this.#called(
                    tool,
                    params?.arguments as Record<string, unknown> | undefined,
                    asker,
                )
                return {
                    result: {
                        content: [{ type: 'text', text }],
                        // 20.16 — the same value as structured content, where the tool declares
                        // its shape; a refusal is not that value.
                        structuredContent:
                            failed || !structured(tool)
                                ? undefined
                                : JSON.parse(text),
                        isError: failed,
                    },
                }
            }
            default:
                return mcpFailure(-32601, `No method ${method}.`)
        }
    }
}

// 20.18 — ONE LINE PER CALL, whoever framed it: this endpoint or a provider's `Toolbox`, and a call
// to a tool that is not published (404) or whose answer threw (500) included. `started` is unset
// where nothing ran, or where the namespace is closed (28.7).
function logCall(
    name: string,
    status: number,
    started: number | undefined,
): void {
    if (!MCP_LOG.enabled()) return
    MCP_LOG.debug(
        'call',
        name,
        status,
        `${started === undefined ? '0.0' : (performance.now() - started).toFixed(1)}ms`,
    )
}

/**
 * `schema` as a tool's `inputSchema`, its top-level `type` `object` whatever it declared there, or
 * `undefined` where no value it admits is an object. 20.19, 20.20.
 */
function toolInput(schema: unknown): object | undefined {
    if (schema === undefined || schema === true) return { type: 'object' }
    if (!admitsObject(schema)) return undefined
    return { ...(schema as object), type: 'object' }
}

/** Whether a JSON Schema admits some object — its `type`, and each of `anyOf`, `oneOf` and `allOf`. */
function admitsObject(schema: unknown): boolean {
    if (schema === true) return true
    if (schema === null || typeof schema !== 'object') return false
    const { type, anyOf, oneOf, allOf } = schema as Record<string, unknown>
    if (
        type !== undefined &&
        type !== 'object' &&
        !(Array.isArray(type) && type.includes('object'))
    )
        return false
    if (Array.isArray(anyOf) && !anyOf.some(admitsObject)) return false
    if (Array.isArray(oneOf) && !oneOf.some(admitsObject)) return false
    return !Array.isArray(allOf) || allOf.every(admitsObject)
}

/**
 * Whether a tool declares an `outputSchema`: MCP's structured content is an object, so only a
 * result schema that is one. 20.16.
 */
function structured(tool: Listed): boolean {
    return (tool.result as { type?: unknown } | undefined)?.type === 'object'
}

/**
 * Answers one MCP JSON-RPC request over `surface`, or `undefined` where it publishes nothing.
 *
 * 20.9 — THE STREAMABLE-HTTP MCP ENDPOINT, answering JSON-RPC over `POST`, as the request's own
 * caller: every handler it lists is a tool, a read as much as a mutation.
 */
export async function answerMcp(
    surface: McpSurface,
    request: Request,
): Promise<unknown> {
    if (!surface.opened) return undefined
    if (request.method !== 'POST')
        return new Response(null, { status: 405, headers: { allow: 'POST' } })
    // 20.12, 16.13 — A POST FROM ANOTHER ORIGIN IS REFUSED, as a mutation's is: a tool call runs a handler
    // with the caller's own cookies, and a `text/plain` body is sent cross-origin with no preflight.
    const crossing = crossingOrigin(request.headers.get('origin'), request.url)
    if (crossing !== null) return answered(crossingRefusal(crossing, 'POST'))
    // 16.78 — under the environment's body ceiling, as a handler's body is.
    const body = await bodyWithin(request, undefined)
    if (isFailed(body)) return answered(body)
    let message: JsonRpc
    try {
        message = (await body.json()) as JsonRpc
    } catch {
        return {
            jsonrpc: '2.0',
            id: null,
            ...mcpFailure(-32700, 'Parse error'),
        }
    }
    // A notification is acknowledged and answered with nothing.
    if (message.id === undefined) return new Response(null, { status: 202 })
    const reply = await surface.answer(message.method, message.params, request)
    return { jsonrpc: '2.0', id: message.id, ...reply }
}

/**
 * The call a tool is, as the request a browser would make.
 *
 * The caller's own headers are carried, so a rung reading them decides as it would for that caller.
 */
function callOf(
    asked: Request,
    handler: Listed,
    args: Record<string, unknown> | undefined,
): Request {
    const method = handler.method
    const call = rpcRequest(
        method,
        handler.address,
        argsInURL(method) ? args : (args ?? {}),
    )
    const headers = new Headers(asked.headers)
    headers.delete('content-length')
    // 38.68 — the answer is read here rather than sent on, and nothing in process decodes it.
    headers.delete('accept-encoding')
    if (call.body !== undefined) headers.set('content-type', 'application/json')
    return new Request(new URL(call.url, asked.url), {
        method,
        headers,
        body: call.body ?? null,
    })
}
