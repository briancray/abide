import { promptRegistry } from '../server/prompts/promptRegistry.ts'
import { dispatchVerbInProcess } from '../server/rpc/dispatchVerbInProcess.ts'
import { findVerbByCommandName } from '../server/rpc/findVerbByCommandName.ts'
import { verbRegistry } from '../server/rpc/verbRegistry.ts'
import { ensureRegistriesLoaded } from '../server/runtime/registryManifests.ts'
import { recentHistory } from '../server/sockets/recentHistory.ts'
import { socketOperations } from '../server/sockets/socketOperations.ts'
import { socketRegistry } from '../server/sockets/socketRegistry.ts'
import { NO_STORE } from '../shared/cacheControlValues.ts'
import { commandNameForUrl } from '../shared/commandNameForUrl.ts'
import { forwardHeaders } from '../shared/forwardHeaders.ts'
import { jsonSchemaForSchema } from '../shared/jsonSchemaForSchema.ts'
import { annotationsForMethod } from './annotationsForMethod.ts'
import { getMcpResourceServer } from './mcpResourceServerSlot.ts'
import { toolResultFromResponse } from './toolResultFromResponse.ts'
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

type ToolDescriptor = {
    name: string
    description: string
    inputSchema: Record<string, unknown>
    outputSchema?: Record<string, unknown>
    annotations?: Record<string, boolean>
}

type PromptDescriptor = {
    name: string
    description?: string
    arguments: Array<{ name: string; description?: string; required: boolean }>
}

/*
Builds the array of MCP tool descriptors.

RPCs: every verb with clients.mcp=true becomes one tool named after the
export's URL (folder segments joined with `-`). The HTTP verb feeds the
tool's annotations (readOnlyHint / destructiveHint / idempotentHint) so
a model can tell a read from a write; reads auto-expose while mutating
verbs require an explicit clients.mcp (see resolveClientFlags). When the
verb declares an `outputSchema` it's advertised as the tool outputSchema.

Sockets: every socket with clients.mcp=true contributes a `<base>-tail`
read tool (recent buffered messages) and, when clientPublish is set, a
`<base>-publish` tool.
*/
function buildTools(): ToolDescriptor[] {
    const tools: ToolDescriptor[] = []
    for (const entry of verbRegistry.values()) {
        if (!entry.clients.mcp) {
            continue
        }
        /*
        Tool description favours the schema's top-level description (the
        vendor's JSON Schema conversion carries `.describe(...)` through),
        falling back to `method url` so the tool is still labelled when
        the schema has none.
        */
        const inputSchema = jsonSchemaForSchema(entry.inputSchema)
        const tool: ToolDescriptor = {
            name: commandNameForUrl(entry.remote.url),
            description:
                (inputSchema.description as string | undefined) ??
                `${entry.remote.method} ${entry.remote.url}`,
            inputSchema,
            annotations: annotationsForMethod(entry.remote.method),
        }
        if (entry.outputSchema) {
            tool.outputSchema = jsonSchemaForSchema(entry.outputSchema)
        }
        tools.push(tool)
    }
    for (const entry of socketRegistry.values()) {
        if (!entry.clients.mcp) {
            continue
        }
        const payloadSchema = jsonSchemaForSchema(entry.schema)
        for (const operation of socketOperations(entry)) {
            if (operation.kind === 'tail') {
                tools.push({
                    name: operation.name,
                    description: `Read recent messages from the "${operation.socketName}" socket`,
                    inputSchema: {
                        type: 'object',
                        properties: {
                            count: { type: 'number', description: 'max recent messages to return' },
                        },
                    },
                    outputSchema: {
                        type: 'object',
                        properties: { frames: { type: 'array', items: payloadSchema } },
                    },
                    annotations: { readOnlyHint: true, destructiveHint: false },
                })
                continue
            }
            tools.push({
                name: operation.name,
                description: `Publish a message to the "${operation.socketName}" socket`,
                inputSchema: payloadSchema,
                annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
            })
        }
    }
    return tools
}

/*
MCP prompts derived from src/mcp/prompts. Arguments come from the JSON
Schema the resolver built from each prompt's frontmatter `arguments` list
(top-level properties + required flags); the model fills them in and the
framework interpolates them into the body on prompts/get.
*/
function buildPrompts(): PromptDescriptor[] {
    return Array.from(promptRegistry.values()).map((entry) => {
        const jsonSchema = entry.jsonSchema ?? {}
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
Tool dispatch. RPC tools synthesize a Request (with forwarded auth
headers) and pipe it through verb.fetch inside the request scope — the
same seam the HTTP router crosses, so validation, the handler, and the
request-scoped helpers (per-call cache(), cookies(), request()) behave
identically. A handler throw is caught by the scope and framed as an
isError tool result (via the 500 response) rather than escaping as a
JSON-RPC error. The response (buffered or streaming) is framed by
toolResultFromResponse. Socket tools (`<base>-tail` / `<base>-publish`)
fall through to the socket dispatcher.
*/
async function callTool(
    toolName: string,
    args: Record<string, unknown> | undefined,
    inbound: Request,
): Promise<Record<string, unknown>> {
    const entry = findVerbByCommandName(toolName)
    if (entry?.clients.mcp) {
        const response = await dispatchVerbInProcess({
            entry,
            args,
            baseUrl: `${new URL(inbound.url).origin}/`,
            headers: forwardHeaders(inbound.headers),
        })
        return toolResultFromResponse(response)
    }
    const socketResult = callSocketTool(toolName, args)
    if (socketResult) {
        return socketResult
    }
    throw new Error(`unknown tool: ${toolName}`)
}

function textResult(text: string, isError = false): Record<string, unknown> {
    return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) }
}

/*
Dispatches the socket tail / publish tools by matching the tool name
against each mcp-exposed socket's operations (socketOperations is the same
projection tools/list advertised, so the publish op only exists when the
socket allows it). tail returns the recent history buffer (request/response
can't hold a live subscription); publish validates against the socket
schema and fans out. Returns undefined when the name isn't a known socket
tool so callTool can fall through to "unknown tool".
*/
function callSocketTool(
    toolName: string,
    args: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
    for (const entry of socketRegistry.values()) {
        if (!entry.clients.mcp) {
            continue
        }
        const operation = socketOperations(entry).find((op) => op.name === toolName)
        if (!operation) {
            continue
        }
        if (operation.kind === 'tail') {
            const count = typeof args?.count === 'number' ? args.count : undefined
            const frames = recentHistory(entry, count)
            return {
                content: [{ type: 'text', text: frames.map((f) => JSON.stringify(f)).join('\n') }],
                structuredContent: { frames },
            }
        }
        try {
            // publish() validates the payload against the socket schema and throws on failure.
            entry.socket.publish(args)
        } catch (error) {
            return textResult(error instanceof Error ? error.message : String(error), true)
        }
        return textResult('ok')
    }
    return undefined
}

/*
Interpolates the caller's arguments into the prompt body and wraps the
result in the MCP prompts/get wire shape — a markdown prompt is a single
user message whose text is the rendered template.
*/
function getPrompt(
    name: string,
    args: Record<string, unknown> | undefined,
): Record<string, unknown> {
    const entry = promptRegistry.get(name)
    if (!entry) {
        throw new Error(`unknown prompt: ${name}`)
    }
    const rendered = entry.prompt.render((args ?? {}) as Record<string, string>)
    return {
        ...(entry.prompt.description ? { description: entry.prompt.description } : {}),
        messages: [{ role: 'user', content: { type: 'text', text: rendered } }],
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
                return jsonRpcOk(id, getPrompt(params.name, params.arguments))
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
