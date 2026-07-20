// The abide MCP SERVER (machine-surfaces.md MS2) — the Model Context Protocol projection of the
// registry, served as JSON-RPC 2.0 over HTTP POST at `/__abide/mcp`. This is the streamable-HTTP
// baseline: a single endpoint that accepts one JSON-RPC request or a batch and answers
// `application/json` (snapshot-poll, not live streaming — MS2.2's robust baseline).
//
// Tools project straight off `buildRegistry` (MS2.1-2.3): each RPC with `clients.mcp !== false`
// becomes a tool (input schema + `readOnlyHint` from read/mutate); each such socket becomes a
// `<name>_tail` snapshot tool and, when `clientPublish`, a `<name>_publish` tool. `clients.mcp`
// governs reachability/curation only — never authorization (MS2.5/DX8): a tool call routes an
// internal request back through the app's full middleware/auth chain, so whatever the app's
// middleware enforces applies here uniformly with the browser and CLI surfaces.

import { error } from '../error.ts'
import { json } from '../json.ts'
import type { Socket } from '../socket.ts'
import type { RpcEntry, SocketEntry } from './registry.ts'
import { buildRegistry } from './registry.ts'
import type { AppConfig } from './router.ts'

const PROTOCOL_VERSION = '2025-06-18'
const SERVER_NAME = 'abide'
const SERVER_VERSION = '0.0.0'

// JSON-RPC 2.0 error codes (subset used here).
const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603

interface JsonRpcRequest {
    jsonrpc?: unknown
    id?: unknown
    method?: unknown
    params?: unknown
}

interface JsonRpcError {
    code: number
    message: string
}

interface McpTool {
    name: string
    description?: string
    inputSchema: Record<string, unknown>
    annotations: { readOnlyHint: boolean }
}

interface McpContent {
    type: 'text'
    text: string
}

interface McpToolResult {
    content: McpContent[]
    isError?: boolean
}

// A handler outcome: exactly one of `result` / `error`, wrapped into the JSON-RPC envelope by the
// caller once the request id is known.
type Outcome = { result: unknown } | { error: JsonRpcError }

function textResult(value: unknown, isError?: boolean): McpToolResult {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    const result: McpToolResult = { content: [{ type: 'text', text }] }
    if (isError === true) result.isError = true
    return result
}

// Project the registry into the MCP tool list (MS2.1-2.3). Only `clients.mcp !== false` surfaces.
function listTools(config: AppConfig): McpTool[] {
    const registry = buildRegistry(config)
    const tools: McpTool[] = []

    for (const rpc of registry.rpcs) {
        if (rpc.clients.mcp === false) continue
        const tool: McpTool = {
            name: rpc.name,
            inputSchema: (rpc.inputSchema as Record<string, unknown> | undefined) ?? {
                type: 'object',
            },
            annotations: { readOnlyHint: rpc.read },
        }
        if (rpc.doc !== undefined) tool.description = rpc.doc
        tools.push(tool)
    }

    for (const sock of registry.sockets) {
        if (sock.clients.mcp === false) continue
        tools.push({
            name: `${sock.name}_tail`,
            description: `Snapshot of the "${sock.name}" socket's current tail buffer.`,
            inputSchema: { type: 'object' },
            annotations: { readOnlyHint: true },
        })
        if (sock.clientPublish) {
            tools.push({
                name: `${sock.name}_publish`,
                description: `Publish a message to the "${sock.name}" socket.`,
                inputSchema: (sock.messageSchema as Record<string, unknown> | undefined) ?? {},
                annotations: { readOnlyHint: false },
            })
        }
    }

    return tools
}

// Dispatch an RPC tool by routing an internal request to `/rpc/<name>` on this same server, so it
// runs the identical middleware/auth chain as any browser or CLI call (MS2.5). Reads carry the
// args object in `?args=`; mutations send it as a JSON body. Auth headers ride along.
async function callRpc(rpc: RpcEntry, args: unknown, request: Request): Promise<McpToolResult> {
    const headers = new Headers()
    const authorization = request.headers.get('authorization')
    if (authorization !== null) headers.set('authorization', authorization)
    const cookie = request.headers.get('cookie')
    if (cookie !== null) headers.set('cookie', cookie)

    const encoded = JSON.stringify(args ?? {})
    let response: Response
    if (rpc.read) {
        const target = new URL(`/rpc/${rpc.name}`, request.url)
        target.searchParams.set('args', encoded)
        response = await fetch(target, { method: rpc.method, headers })
    } else {
        const target = new URL(`/rpc/${rpc.name}`, request.url)
        headers.set('content-type', 'application/json')
        response = await fetch(target, { method: rpc.method, headers, body: encoded })
    }

    const body = await response.text()
    let payload: unknown = body
    try {
        payload = JSON.parse(body)
    } catch {
        // Non-JSON body — surface the raw text.
    }
    return textResult(payload, !response.ok)
}

async function callTool(
    name: string,
    args: unknown,
    config: AppConfig,
    request: Request,
): Promise<Outcome> {
    const registry = buildRegistry(config)

    // RPC tools first — a registry name is exact and could collide with a socket-derived suffix.
    for (const rpc of registry.rpcs) {
        if (rpc.clients.mcp === false) continue
        if (rpc.name === name) {
            try {
                return { result: await callRpc(rpc, args, request) }
            } catch (caught) {
                return {
                    error: {
                        code: INTERNAL_ERROR,
                        message: caught instanceof Error ? caught.message : 'tool call failed',
                    },
                }
            }
        }
    }

    const sockets = config.sockets ?? {}
    const socketOutcome = await callSocketTool(name, args, registry.sockets, sockets)
    if (socketOutcome !== undefined) return socketOutcome

    return { error: { code: INVALID_PARAMS, message: `Unknown tool: ${name}` } }
}

// Match a `<name>_tail` / `<name>_publish` tool against the exposed sockets. Returns undefined when
// no socket tool matches (so the caller can fall through to "unknown tool").
async function callSocketTool(
    name: string,
    args: unknown,
    entries: SocketEntry[],
    sockets: Record<string, Socket<unknown>>,
): Promise<Outcome | undefined> {
    for (const entry of entries) {
        if (entry.clients.mcp === false) continue
        const sock = sockets[entry.name]
        if (sock === undefined) continue

        if (name === `${entry.name}_tail`) {
            return { result: textResult(sock.__socket.tailSnapshot()) }
        }
        if (entry.clientPublish && name === `${entry.name}_publish`) {
            try {
                await sock.__socket.ingressPublish(args)
                return { result: textResult({ ok: true }) }
            } catch (caught) {
                return {
                    result: textResult(
                        caught instanceof Error ? caught.message : 'publish rejected',
                        true,
                    ),
                }
            }
        }
    }
    return undefined
}

// Handle one JSON-RPC message. Returns the outcome, or null for a notification (no id → no reply).
async function handleMessage(
    message: JsonRpcRequest,
    config: AppConfig,
    request: Request,
): Promise<Outcome | null> {
    if (typeof message !== 'object' || message === null || typeof message.method !== 'string') {
        return { error: { code: INVALID_REQUEST, message: 'Invalid JSON-RPC request.' } }
    }

    const method = message.method
    const isNotification = message.id === undefined || message.id === null

    switch (method) {
        case 'initialize':
            return {
                result: {
                    protocolVersion: PROTOCOL_VERSION,
                    capabilities: { tools: {} },
                    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
                },
            }
        case 'tools/list':
            return { result: { tools: listTools(config) } }
        case 'tools/call': {
            const params = (message.params ?? {}) as { name?: unknown; arguments?: unknown }
            if (typeof params.name !== 'string') {
                return {
                    error: {
                        code: INVALID_PARAMS,
                        message: 'tools/call requires a string `name`.',
                    },
                }
            }
            return callTool(params.name, params.arguments, config, request)
        }
        default:
            // Notifications (e.g. `notifications/initialized`) are accepted silently; unknown *requests*
            // (carrying an id) get a method-not-found error.
            if (isNotification) return null
            return { error: { code: METHOD_NOT_FOUND, message: `Method not found: ${method}` } }
    }
}

function envelope(id: unknown, outcome: Outcome): Record<string, unknown> {
    if ('error' in outcome) return { jsonrpc: '2.0', id: id ?? null, error: outcome.error }
    return { jsonrpc: '2.0', id: id ?? null, result: outcome.result }
}

export async function handleMcp(request: Request, config: AppConfig): Promise<Response> {
    if (request.method.toUpperCase() !== 'POST') {
        return error(405, 'MCP endpoint accepts POST only.')
    }

    let body: unknown
    try {
        body = await request.json()
    } catch {
        return json({
            jsonrpc: '2.0',
            id: null,
            error: { code: PARSE_ERROR, message: 'Parse error.' },
        })
    }

    // Batch: process each, keep only the replies for messages that carried an id.
    if (Array.isArray(body)) {
        const replies: Record<string, unknown>[] = []
        for (const message of body) {
            const outcome = await handleMessage(message as JsonRpcRequest, config, request)
            if (outcome === null) continue
            replies.push(envelope((message as JsonRpcRequest).id, outcome))
        }
        if (replies.length === 0) return new Response(null, { status: 202 })
        return json(replies)
    }

    const message = body as JsonRpcRequest
    const outcome = await handleMessage(message, config, request)
    if (outcome === null) return new Response(null, { status: 202 })
    return json(envelope(message.id, outcome))
}
