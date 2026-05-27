import { verbRegistry } from '../server/rpc/verbRegistry.ts'
import { socketRegistry } from '../server/sockets/socketRegistry.ts'
import { buildRpcRequest } from '../shared/buildRpcRequest.ts'
import { NO_STORE } from '../shared/cacheControlValues.ts'
import { commandNameForUrl } from '../shared/commandNameForUrl.ts'
import { decodeResponse } from '../shared/decodeResponse.ts'
import { forwardHeaders } from '../shared/forwardHeaders.ts'
import { jsonSchemaForSchema } from './jsonSchemaForSchema.ts'
import { ensureMcpRegistriesLoaded } from './mcpManifests.ts'
import type { JsonRpcRequest } from './types/JsonRpcRequest.ts'
import type { JsonRpcResponse } from './types/JsonRpcResponse.ts'
import type { McpServerOptions } from './types/McpServerOptions.ts'

const PROTOCOL_VERSION = '2025-06-18'
const STREAM_URI_PREFIX = 'belte://stream/'

function jsonRpcError(
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown,
): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}

function jsonRpcOk(id: string | number | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result }
}

/*
Builds the array of MCP tool descriptors. Each rpc with clients.mcp=true
becomes one tool named after the export's URL (folder segments joined
with `-` so two files with the same stem in different folders don't
collide). Each socket with clients.mcp becomes optionally a
publish_<name> tool (when allowClientPublish) and always an await_<name>
tool that blocks for the next history entry.
*/
function buildTools(): Array<{
    name: string
    description: string
    inputSchema: Record<string, unknown>
}> {
    const tools: Array<{
        name: string
        description: string
        inputSchema: Record<string, unknown>
    }> = []
    for (const entry of verbRegistry.values()) {
        if (!entry.clients.mcp) {
            continue
        }
        tools.push({
            name: commandNameForUrl(entry.remote.url),
            description: `${entry.remote.method} ${entry.remote.url}`,
            inputSchema: jsonSchemaForSchema(entry.schema, entry.jsonSchema),
        })
    }
    for (const entry of socketRegistry.values()) {
        if (!entry.clients.mcp) {
            continue
        }
        const payloadSchema = jsonSchemaForSchema(entry.schema, entry.jsonSchema)
        tools.push({
            name: `await_${entry.socket.name}`,
            description: `Block for the next entry published to socket "${entry.socket.name}".`,
            inputSchema: {
                type: 'object',
                properties: {
                    timeoutMs: {
                        type: 'number',
                        description: 'Max ms to wait. Default 30000.',
                    },
                },
            },
        })
        if (entry.allowClientPublish) {
            tools.push({
                name: `publish_${entry.socket.name}`,
                description: `Publish a message to socket "${entry.socket.name}".`,
                inputSchema: payloadSchema,
            })
        }
    }
    return tools
}

function buildResources(): Array<{
    uri: string
    name: string
    description: string
    mimeType: string
}> {
    const resources: Array<{
        uri: string
        name: string
        description: string
        mimeType: string
    }> = []
    for (const entry of socketRegistry.values()) {
        if (!entry.clients.mcp) {
            continue
        }
        resources.push({
            uri: `${STREAM_URI_PREFIX}${entry.socket.name}`,
            name: entry.socket.name,
            description: `Latest history window of socket "${entry.socket.name}".`,
            mimeType: 'application/json',
        })
    }
    return resources
}

/*
Tool dispatch. RPCs synthesize a Request (with forwarded auth headers)
and pipe it through verb.fetch — same code path the HTTP router uses,
so validation + handler + error helpers behave identically. Socket
tools (await_/publish_) bypass HTTP since they're in-process by nature.
*/
async function callTool(
    toolName: string,
    args: Record<string, unknown> | undefined,
    inbound: Request,
): Promise<Record<string, unknown>> {
    if (toolName.startsWith('await_')) {
        const socketName = toolName.slice('await_'.length)
        const entry = socketRegistry.get(socketName)
        if (!entry || !entry.clients.mcp) {
            throw new Error(`unknown tool: ${toolName}`)
        }
        const timeoutMs = (args?.timeoutMs as number | undefined) ?? 30_000
        /*
        Hold onto the iterator so the timeout branch can close it. Without
        the explicit return(), a timed-out await leaves a subscriber wired
        into defineSocket's `subscribers` set and the next publish wakes
        it before noticing it's abandoned — one leaked subscriber per
        timed-out call.
        */
        const iterator = entry.socket.tail(0)[Symbol.asyncIterator]()
        let value: unknown
        try {
            const raced = await Promise.race([
                iterator.next(),
                new Promise<IteratorResult<unknown>>((resolve) => {
                    setTimeout(() => resolve({ value: undefined, done: true }), timeoutMs)
                }),
            ])
            value = raced.done ? undefined : raced.value
        } finally {
            iterator.return?.(undefined)?.catch(() => undefined)
        }
        return {
            content: [
                {
                    type: 'text',
                    text:
                        value === undefined
                            ? `(timeout after ${timeoutMs}ms)`
                            : JSON.stringify(value),
                },
            ],
        }
    }
    if (toolName.startsWith('publish_')) {
        const socketName = toolName.slice('publish_'.length)
        const entry = socketRegistry.get(socketName)
        if (!entry || !entry.clients.mcp || !entry.allowClientPublish) {
            throw new Error(`unknown tool: ${toolName}`)
        }
        entry.socket.publish(args)
        return { content: [{ type: 'text', text: 'published' }] }
    }
    // Plain RPC tool — find verb whose folder-prefixed name matches.
    let found: ReturnType<(typeof verbRegistry)['get']> | undefined
    for (const entry of verbRegistry.values()) {
        if (!entry.clients.mcp) {
            continue
        }
        if (commandNameForUrl(entry.remote.url) === toolName) {
            found = entry
            break
        }
    }
    if (!found) {
        throw new Error(`unknown tool: ${toolName}`)
    }
    const inboundUrl = new URL(inbound.url)
    const baseUrl = `${inboundUrl.protocol}//${inboundUrl.host}/`
    const request = buildRpcRequest({
        method: found.remote.method,
        url: found.remote.url,
        args,
        baseUrl,
        headers: forwardHeaders(inbound.headers),
    })
    const response = await found.remote.fetch(request)
    if (!response.ok) {
        return {
            content: [
                {
                    type: 'text',
                    text: `${response.status} ${response.statusText}: ${await response.text()}`,
                },
            ],
            isError: true,
        }
    }
    const body = await decodeResponse(response.clone())
    return {
        content: [
            {
                type: 'text',
                text: typeof body === 'string' ? body : JSON.stringify(body),
            },
        ],
    }
}

async function readResource(uri: string): Promise<Record<string, unknown>> {
    if (!uri.startsWith(STREAM_URI_PREFIX)) {
        throw new Error(`unknown resource: ${uri}`)
    }
    const socketName = uri.slice(STREAM_URI_PREFIX.length)
    const entry = socketRegistry.get(socketName)
    if (!entry || !entry.clients.mcp) {
        throw new Error(`unknown resource: ${uri}`)
    }
    return {
        contents: [
            {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(entry.snapshotHistory()),
            },
        ],
    }
}

/*
Parses a single JSON-RPC envelope and dispatches by method. Errors
become JSON-RPC error responses (the HTTP layer always returns 200 with
an envelope for JSON-RPC over HTTP; transport errors are different).
*/
export async function dispatchMcpRequest(
    request: Request,
    opts: McpServerOptions,
    serverInfo: { name: string; version: string },
): Promise<JsonRpcResponse> {
    let envelope: JsonRpcRequest
    try {
        envelope = (await request.clone().json()) as JsonRpcRequest
    } catch {
        return jsonRpcError(null, -32700, 'Parse error')
    }
    const id = envelope.id ?? null
    if (envelope.jsonrpc !== '2.0' || typeof envelope.method !== 'string') {
        return jsonRpcError(id, -32600, 'Invalid Request')
    }

    if (opts.authorize) {
        try {
            await opts.authorize(request)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return jsonRpcError(id, -32001, message)
        }
    }

    try {
        await ensureMcpRegistriesLoaded()
        switch (envelope.method) {
            case 'initialize':
                return jsonRpcOk(id, {
                    protocolVersion: PROTOCOL_VERSION,
                    capabilities: {
                        tools: { listChanged: false },
                        resources: { subscribe: false, listChanged: false },
                    },
                    serverInfo,
                })
            case 'ping':
                return jsonRpcOk(id, {})
            case 'tools/list':
                return jsonRpcOk(id, { tools: buildTools() })
            case 'tools/call': {
                const params = envelope.params as
                    | { name?: string; arguments?: Record<string, unknown> }
                    | undefined
                if (!params?.name) {
                    return jsonRpcError(id, -32602, 'Missing tool name')
                }
                return jsonRpcOk(id, await callTool(params.name, params.arguments, request))
            }
            case 'resources/list':
                return jsonRpcOk(id, { resources: buildResources() })
            case 'resources/read': {
                const params = envelope.params as { uri?: string } | undefined
                if (!params?.uri) {
                    return jsonRpcError(id, -32602, 'Missing resource uri')
                }
                return jsonRpcOk(id, await readResource(params.uri))
            }
            default:
                return jsonRpcError(id, -32601, `Method not found: ${envelope.method}`)
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return jsonRpcError(id, -32603, message)
    }
}

export const MCP_NO_STORE_HEADERS = {
    'Content-Type': 'application/json',
    'Cache-Control': NO_STORE,
} as const
