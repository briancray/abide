// SECTION 20 — WHAT IS GENERATED OFF THE ROUTE TABLE: the OpenAPI document, the MCP endpoint, and 36.7's
// `GET` over `log.records`. Each is derived from the handlers the app mounted (20.1) and none is
// authored beside them; each is closed until its `ABIDE_*` opens it, and a closed one is a 404 (36.7).
//
// THE SURFACES ANSWER INSIDE THE APP'S OWN MIDDLEWARE (20.8), because they are answered from the one
// request path everything under `/__abide` is — and a tool call is a request through it again (20.10).
//
// WHAT EACH SURFACE LISTS, AND AS WHAT, is `surfaceOf`'s — the command line's listing reads it too —
// and the MCP protocol is `McpSurface`'s alone, whoever frames it: this endpoint over http, or a
// provider that speaks MCP itself (`assistant`'s `forwardOf`).
//
// WHAT ONLY THE TYPE SAYS IS THE BUILD'S, arriving here on the mount: 16.38's default of `mcp` and
// `cli` to false for a handler returning a `Response`, 20.4's `ui: false`, and 20.11's type-derived
// schema (19.10) as `argsDocument`.

import { log, namedLogger } from '#shared/log.ts'
import { type Reactive, reactive } from '#shared/reactive/index.ts'
import { argsInURL, rpcRequest } from '#shared/rpcRequest.ts'
import { answered } from './answerFailure.ts'
import type { Mounted } from './answerRpc.ts'
import { framed } from './answerValue.ts'
import type { ToolDefinition } from './assistant.ts'
import { appIdentity, config } from './config.ts'
import { crossingOrigin, crossingRefusal } from './crossingOrigin.ts'
import { MCP_PROTOCOL_VERSION } from './MCP_PROTOCOL_VERSION.ts'
import { type Listed, surfaceOf } from './surfaceOf.ts'

const OPENAPI_LOG = namedLogger('abide:openapi')
const MCP_LOG = namedLogger('abide:mcp')

/** Whether the `ABIDE_*` setting `name` opens its surface. 36.7. */
function opened(name: string): boolean {
    return (config.peek()?.[name] as unknown) === true
}

// What MCP and OpenAPI add to a listing: whether the handler is keyed, and its name where only
// letters, digits, `_` and `-` are admitted — a tool's, an operation's.
type Published = Listed & { keyed: boolean; name: string }

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
            name: one.path.replace(/[^a-zA-Z0-9_-]/g, '_'),
        })
    }
    return found
}

/** The OpenAPI 3.1 document, each handler's `JsonSchema` published as it stands. 20.6. */
function openApiOf(handlers: Map<string, Mounted>): unknown {
    const paths: Record<string, Record<string, unknown>> = {}
    for (const each of listed(handlers, 'openapi')) {
        const operation: Record<string, unknown> = {
            operationId: each.name,
            responses: {
                '200': {
                    description: 'The value.',
                    content: { 'application/json': {} },
                },
                '204': { description: 'Nothing to say.' },
                default: {
                    description: 'A refusal: name, status, message and data.',
                },
            },
        }
        if (each.description !== undefined)
            operation.description = each.description
        if (each.keyed && each.schema === undefined)
            OPENAPI_LOG.warning(
                `${each.address} has no JSON Schema to publish for its args.`,
            )
        if (each.schema !== undefined) {
            if (argsInURL(each.method)) {
                const properties =
                    (
                        each.schema as {
                            properties?: Record<string, unknown>
                            required?: string[]
                        }
                    ).properties ?? {}
                const required = new Set(
                    (each.schema as { required?: string[] }).required ?? [],
                )
                operation.parameters = Object.entries(properties).map(
                    ([name, schema]) => ({
                        name,
                        in: 'query',
                        required: required.has(name),
                        schema,
                    }),
                )
            } else
                operation.requestBody = {
                    required: true,
                    content: { 'application/json': { schema: each.schema } },
                }
        }
        paths[each.address] ??= {}
        ;(paths[each.address] as Record<string, unknown>)[
            each.method.toLowerCase()
        ] = operation
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

const documents = new WeakMap<Map<string, Mounted>, Reactive<unknown>>()

/** The OpenAPI document over the route table, or `undefined` where `ABIDE_OPENAPI` is closed. */
export function openApi(
    handlers: Map<string, Mounted>,
): Reactive<unknown> | undefined {
    return opened('ABIDE_OPENAPI')
        ? overTable(documents, handlers, openApiOf)
        : undefined
}

/** What the MCP surface publishes: a tool per call that takes args or writes, a resource per read. */
type Tools = { tools: Published[]; resources: Published[] }

const published = new WeakMap<Map<string, Mounted>, Reactive<Tools>>()

function toolsOf(handlers: Map<string, Mounted>): Tools {
    const found: Tools = { tools: [], resources: [] }
    for (const one of listed(handlers, 'mcp'))
        if (one.keyed || one.method !== 'GET') found.tools.push(one)
        else found.resources.push(one)
    return found
}

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
        this.#handlers = handlers
        this.#answer = answer
    }

    /** Whether `ABIDE_MCP` has opened it. 20.7. */
    get opened(): boolean {
        return opened('ABIDE_MCP')
    }

    #published(): Tools {
        return overTable(published, this.#handlers, toolsOf)()
    }

    /** Every tool it lists. 20.9. */
    list(): ToolDefinition[] {
        const listing: ToolDefinition[] = []
        for (const tool of this.#published().tools) {
            if (tool.description === undefined)
                MCP_LOG.warning(
                    `${tool.name} is published with no description.`,
                )
            listing.push({
                name: tool.name,
                description: tool.description ?? '',
                inputSchema: tool.schema ?? { type: 'object' },
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
        if (tool === undefined)
            return Promise.resolve({
                text: `No tool named ${name}.`,
                failed: true,
            })
        return this.#called(tool, args as Record<string, unknown>, asker)
    }

    #tool(name: unknown): Published | undefined {
        return this.#published().tools.find((one) => one.name === name)
    }

    async #called(
        one: Published,
        args: Record<string, unknown> | undefined,
        asker: Request,
    ): Promise<{ text: string; failed: boolean }> {
        const answer = await this.#answer(callOf(asker, one, args))
        return { text: await answer.text(), failed: answer.status >= 400 }
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
                        capabilities: { tools: {}, resources: {} },
                        serverInfo: appIdentity(),
                    },
                }
            case 'ping':
                return { result: {} }
            case 'tools/list':
                return { result: { tools: this.list() } }
            case 'resources/list':
                return {
                    result: {
                        resources: this.#published().resources.map(
                            (resource) => ({
                                uri: `abide:${resource.address}`,
                                name: resource.name,
                                description: resource.description ?? '',
                                mimeType: 'application/json',
                            }),
                        ),
                    },
                }
            case 'tools/call': {
                const tool = this.#tool(params?.name)
                if (tool === undefined)
                    return mcpFailure(
                        -32602,
                        `No tool named ${String(params?.name)}.`,
                    )
                const { text, failed } = await this.#called(
                    tool,
                    params?.arguments as Record<string, unknown> | undefined,
                    asker,
                )
                return {
                    result: {
                        content: [{ type: 'text', text }],
                        isError: failed,
                    },
                }
            }
            case 'resources/read': {
                const uri = String(params?.uri ?? '')
                const resource = this.#published().resources.find(
                    (one) => `abide:${one.address}` === uri,
                )
                if (resource === undefined)
                    return mcpFailure(-32602, `No resource at ${uri}.`)
                const { text, failed } = await this.#called(
                    resource,
                    undefined,
                    asker,
                )
                if (failed) return mcpFailure(-32603, text)
                return {
                    result: {
                        contents: [{ uri, mimeType: 'application/json', text }],
                    },
                }
            }
            default:
                return mcpFailure(-32601, `No method ${method}.`)
        }
    }
}

/**
 * Answers one MCP JSON-RPC request over `surface`, or `undefined` where `ABIDE_MCP` is closed.
 *
 * 20.9 — THE STREAMABLE-HTTP MCP ENDPOINT, answering JSON-RPC over `POST`, as the request's own
 * caller: a handler that takes no args is a resource, read at its address; one that takes args, and
 * every mutation, is a tool.
 */
export async function answerMcp(
    surface: McpSurface,
    request: Request,
): Promise<unknown> {
    if (!surface.opened) return undefined
    if (request.method !== 'POST')
        return new Response(null, { status: 405, headers: { allow: 'POST' } })
    // 20.12, 16.14 — A POST FROM ANOTHER ORIGIN IS REFUSED, as a mutation's is: a tool call runs a handler
    // with the caller's own cookies, and a `text/plain` body is sent cross-origin with no preflight.
    const crossing = crossingOrigin(request.headers.get('origin'), request.url)
    if (crossing !== null) return answered(crossingRefusal(crossing, 'POST'))
    let message: JsonRpc
    try {
        message = (await request.json()) as JsonRpc
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
    // 38.69 — the answer is read here rather than sent on, and nothing in process decodes it.
    headers.delete('accept-encoding')
    if (call.body !== undefined) headers.set('content-type', 'application/json')
    return new Request(new URL(call.url, asked.url), {
        method,
        headers,
        body: call.body ?? null,
    })
}

/**
 * The `log.records` event stream, or `undefined` where `ABIDE_LOGS` is closed.
 *
 * 36.7, 28.1 — THE `GET` OVER `log.records`: the ring, and then every line as it is written,
 * framed as server-sent events — which is what `abide logs` subscribes to.
 */
export function answerLogs(request: Request): Response | undefined {
    if (!opened('ABIDE_LOGS')) return undefined
    const cursor = log.records
        .history(Number.MAX_SAFE_INTEGER)
        [Symbol.asyncIterator]()
    request.signal.addEventListener(
        'abort',
        () => void cursor.return?.(undefined),
    )
    return framed(cursor, 'sse', new Headers(), 200)
}
