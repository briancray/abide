import { promptRegistry } from '../server/prompts/promptRegistry.ts'
import type { HttpVerb } from '../server/rpc/types/HttpVerb.ts'
import { verbRegistry } from '../server/rpc/verbRegistry.ts'
import { ensureRegistriesLoaded } from '../server/runtime/registryManifests.ts'
import { buildRpcRequest } from '../shared/buildRpcRequest.ts'
import { NO_STORE } from '../shared/cacheControlValues.ts'
import { commandNameForUrl } from '../shared/commandNameForUrl.ts'
import { decodeResponse } from '../shared/decodeResponse.ts'
import { forwardHeaders } from '../shared/forwardHeaders.ts'
import { jsonSchemaForSchema } from '../shared/jsonSchemaForSchema.ts'
import { getMcpResourceServer } from './mcpResourceServerSlot.ts'
import type { JsonRpcRequest } from './types/JsonRpcRequest.ts'
import type { JsonRpcResponse } from './types/JsonRpcResponse.ts'
import type { McpServerOptions } from './types/McpServerOptions.ts'

const PROTOCOL_VERSION = '2025-06-18'

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
Builds the array of MCP tool descriptors. Every rpc with clients.mcp=true
becomes one tool named after the export's URL (folder segments joined
with `-`), regardless of HTTP verb — GET reads and mutating verbs alike.
Sockets are never exposed to MCP.
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
    return tools
}

/*
MCP prompts derived from src/mcp/prompts. Arguments come from the
prompt's schema (top-level properties + required flags); the model fills
them in and the framework validates + renders on prompts/get.
*/
function buildPrompts(): Array<{
    name: string
    description?: string
    arguments: Array<{ name: string; description?: string; required: boolean }>
}> {
    return Array.from(promptRegistry.values()).map((entry) => {
        const jsonSchema = jsonSchemaForSchema(entry.schema, entry.jsonSchema)
        const properties = (jsonSchema.properties ?? {}) as Record<string, { description?: string }>
        const required = new Set((jsonSchema.required as string[] | undefined) ?? [])
        return {
            name: entry.prompt.name,
            ...(entry.prompt.description ? { description: entry.prompt.description } : {}),
            arguments: Object.entries(properties).map(([argName, prop]) => ({
                name: argName,
                ...(prop?.description ? { description: prop.description } : {}),
                required: required.has(argName),
            })),
        }
    })
}

/*
Tool dispatch. Synthesizes a Request (with forwarded auth headers) and
pipes it through verb.fetch — the same code path the HTTP router uses, so
validation + handler + error helpers behave identically. Every rpc is a
tool regardless of verb.
*/
async function callTool(
    toolName: string,
    args: Record<string, unknown> | undefined,
    inbound: Request,
): Promise<Record<string, unknown>> {
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
    const response = await runRpc(found.remote.method, found.remote.url, args, inbound)
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

/*
Synthesizes the rpc Request and dispatches through verb.fetch, forwarding
the inbound MCP request's auth headers so session/bearer middleware keeps
working. Shared by tool calls (non-GET) and resource reads (GET).
*/
function runRpc(
    method: HttpVerb,
    url: string,
    args: Record<string, unknown> | undefined,
    inbound: Request,
): Promise<Response> {
    const inboundUrl = new URL(inbound.url)
    const baseUrl = `${inboundUrl.protocol}//${inboundUrl.host}/`
    const request = buildRpcRequest({
        method,
        url,
        args,
        baseUrl,
        headers: forwardHeaders(inbound.headers),
    })
    const entry = verbRegistry.get(url)
    if (entry && entry.remote.method === method) {
        return entry.remote.fetch(request)
    }
    throw new Error(`unknown rpc: ${method} ${url}`)
}

/*
Validates prompt arguments against the prompt's schema (when present),
renders the messages, and maps them to the MCP prompts/get wire shape.
A bare string render result becomes a single user message.
*/
async function getPrompt(
    name: string,
    args: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
    const entry = promptRegistry.get(name)
    if (!entry) {
        throw new Error(`unknown prompt: ${name}`)
    }
    let value: unknown = args ?? {}
    if (entry.schema) {
        const result = await entry.schema['~standard'].validate(value)
        if (result.issues) {
            throw new Error(
                `prompt "${name}" arguments failed validation: ${JSON.stringify(result.issues)}`,
            )
        }
        value = result.value
    }
    const rendered = await entry.prompt.render(value as Record<string, string>)
    const messages =
        typeof rendered === 'string'
            ? [{ role: 'user', content: { type: 'text', text: rendered } }]
            : rendered.map((message) => ({
                  role: message.role,
                  content: { type: 'text', text: message.text },
              }))
    return {
        ...(entry.prompt.description ? { description: entry.prompt.description } : {}),
        messages,
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
        await ensureRegistriesLoaded()
        switch (envelope.method) {
            case 'initialize':
                return jsonRpcOk(id, {
                    protocolVersion: PROTOCOL_VERSION,
                    capabilities: {
                        tools: { listChanged: false },
                        prompts: { listChanged: false },
                        resources: { listChanged: false },
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
            case 'resources/list': {
                const resourceServer = getMcpResourceServer()
                return jsonRpcOk(id, {
                    resources: resourceServer ? await resourceServer.list() : [],
                })
            }
            case 'resources/read': {
                const params = envelope.params as { uri?: string } | undefined
                if (!params?.uri) {
                    return jsonRpcError(id, -32602, 'Missing resource uri')
                }
                const resourceServer = getMcpResourceServer()
                const contents = resourceServer ? await resourceServer.read(params.uri) : undefined
                if (!contents) {
                    return jsonRpcError(id, -32602, `unknown resource: ${params.uri}`)
                }
                return jsonRpcOk(id, { contents: [contents] })
            }
            case 'prompts/list':
                return jsonRpcOk(id, { prompts: buildPrompts() })
            case 'prompts/get': {
                const params = envelope.params as
                    | { name?: string; arguments?: Record<string, unknown> }
                    | undefined
                if (!params?.name) {
                    return jsonRpcError(id, -32602, 'Missing prompt name')
                }
                return jsonRpcOk(id, await getPrompt(params.name, params.arguments))
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
