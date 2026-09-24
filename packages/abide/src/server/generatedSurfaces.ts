// SECTION 20 — WHAT IS GENERATED OFF THE ROUTE TABLE: the OpenAPI document, the MCP endpoint, and 36.7's
// `GET` over `log.records`. Each is derived from the handlers the app mounted (20.1) and none is
// authored beside them; each is closed until its `ABIDE_*` opens it, and a closed one is a 404 (36.7).
//
// THE SURFACES ANSWER INSIDE THE APP'S OWN MIDDLEWARE (20.8), because they are answered from the one
// request path everything under `/__abide` is — and a tool call is a request through it again (20.10).
//
// NOT HERE YET: 20.4's `ui: false`, which is the build's to withhold; 16.38's default of `mcp` and
// `cli` to false for a handler returning a `Response`, which wants the return type; and 20.11's
// type-derived schema, which waits on 19.10.

import { log, namedLogger } from '#shared/log.ts'
import { type Reactive, reactive } from '#shared/reactive/index.ts'
import type { Method } from '#shared/rpc.ts'
import { argsInURL, rpcRequest } from '#shared/rpcRequest.ts'
import type { Mounted } from './answerRpc.ts'
import { framed } from './answerValue.ts'
import { appIdentity, config } from './config.ts'

const OPENAPI_LOG = namedLogger('abide:openapi')
const MCP_LOG = namedLogger('abide:mcp')

// 36.7.
function opened(name: string): boolean {
    return (config.peek()?.[name] as unknown) === true
}

type Listed = {
    address: string
    method: Method
    name: string
    description: string | undefined
    keyed: boolean
    schema: unknown
}

// 20.2, 20.3 — every handler, withheld only where its own `clients` says so.
function listed(
    handlers: Map<string, Mounted>,
    surface: 'openapi' | 'mcp',
): Listed[] {
    const found: Listed[] = []
    for (const [address, mounted] of handlers) {
        const handler = mounted.handler
        if (handler.clients[surface] === false) {
            if (surface === 'mcp') MCP_LOG.debug('withheld', address)
            continue
        }
        found.push({
            address,
            method: mounted.method,
            // An MCP tool's name admits letters, digits, `_` and `-` alone, so the path is joined by `_`.
            name: `${mounted.source.replace(/^server\/rpc\//, '').replace(/\.ts$/, '')}/${mounted.name}`.replace(
                /[^a-zA-Z0-9_-]/g,
                '_',
            ),
            description: handler.description,
            keyed: handler.keyed,
            // 20.11 — the schema's own JSON Schema, probed at mount.
            schema: mounted.argsDocument,
        })
    }
    return found
}

// 20.6 — OpenAPI 3.1, the handler's `JsonSchema` published as it stands.
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

// 20.5 — FROM A `reactive` OVER THE ROUTE TABLE, with no `ttl`: the table is fixed for the life of
// the app, so each surface is built once and served thereafter. A surface's own cache, so an app that
// opens one does not build the other.
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

export function openApi(
    handlers: Map<string, Mounted>,
): Reactive<unknown> | undefined {
    return opened('ABIDE_OPENAPI')
        ? overTable(documents, handlers, openApiOf)
        : undefined
}

type Published = { tools: Listed[]; resources: Listed[] }

const published = new WeakMap<Map<string, Mounted>, Reactive<Published>>()

function publishedOf(handlers: Map<string, Mounted>): Published {
    const found: Published = { tools: [], resources: [] }
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

// 20.9 — THE STREAMABLE-HTTP MCP ENDPOINT, answering JSON-RPC over `POST`. A handler that takes no
// args is a resource, read at its address; one that takes args, and every mutation, is a tool.
// A call is made as a request through the app (`fetch`), so its rungs run and refuse as they would
// for anyone (20.10).
export async function answerMcp(
    handlers: Map<string, Mounted>,
    request: Request,
    fetch: (request: Request) => Promise<Response>,
): Promise<unknown> {
    if (!opened('ABIDE_MCP')) return undefined
    if (request.method !== 'POST')
        return new Response(null, { status: 405, headers: { allow: 'POST' } })
    let message: JsonRpc
    try {
        message = (await request.json()) as JsonRpc
    } catch {
        return failure(null, -32700, 'Parse error')
    }
    // A notification is acknowledged and answered with nothing.
    if (message.id === undefined) return new Response(null, { status: 202 })
    const reply = (result: unknown): unknown => ({
        jsonrpc: '2.0',
        id: message.id,
        result,
    })
    const { tools, resources } = overTable(published, handlers, publishedOf)()
    switch (message.method) {
        case 'initialize':
            return reply({
                protocolVersion: '2025-06-18',
                capabilities: { tools: {}, resources: {} },
                serverInfo: appIdentity(),
            })
        case 'ping':
            return reply({})
        case 'tools/list':
            return reply({
                tools: tools.map((tool) => {
                    if (tool.description === undefined)
                        MCP_LOG.warning(
                            `${tool.name} is published with no description.`,
                        )
                    return {
                        name: tool.name,
                        description: tool.description ?? '',
                        inputSchema: tool.schema ?? { type: 'object' },
                    }
                }),
            })
        case 'resources/list':
            return reply({
                resources: resources.map((resource) => ({
                    uri: `abide:${resource.address}`,
                    name: resource.name,
                    description: resource.description ?? '',
                    mimeType: 'application/json',
                })),
            })
        case 'tools/call': {
            const tool = tools.find((one) => one.name === message.params?.name)
            if (tool === undefined)
                return failure(
                    message.id,
                    -32602,
                    `No tool named ${String(message.params?.name)}.`,
                )
            const answer = await fetch(
                callOf(
                    request,
                    tool,
                    message.params?.arguments as
                        | Record<string, unknown>
                        | undefined,
                ),
            )
            const text = await answer.text()
            return reply({
                content: [{ type: 'text', text }],
                isError: answer.status >= 400,
            })
        }
        case 'resources/read': {
            const uri = String(message.params?.uri ?? '')
            const resource = resources.find(
                (one) => `abide:${one.address}` === uri,
            )
            if (resource === undefined)
                return failure(message.id, -32602, `No resource at ${uri}.`)
            const answer = await fetch(callOf(request, resource, undefined))
            const text = await answer.text()
            if (answer.status >= 400) return failure(message.id, -32603, text)
            return reply({
                contents: [{ uri, mimeType: 'application/json', text }],
            })
        }
        default:
            return failure(message.id, -32601, `No method ${message.method}.`)
    }
}

function failure(id: JsonRpc['id'], code: number, text: string): unknown {
    return { jsonrpc: '2.0', id, error: { code, message: text } }
}

// The call a tool is, as the request a browser would make — the caller's own headers carried, so a
// rung reading them decides as it would for that caller.
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
    if (call.body !== undefined) {
        headers.set('content-type', 'application/json')
        headers.delete('origin')
    }
    return new Request(new URL(call.url, asked.url), {
        method,
        headers,
        body: call.body ?? null,
    })
}

// 36.7, 28.1 — THE `GET` OVER `log.records`: the ring, and then every line as it is written, framed as
// server-sent events — which is what `abide logs` subscribes to.
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
