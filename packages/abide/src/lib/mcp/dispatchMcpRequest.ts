import { ensureRegistriesLoaded } from '../server/runtime/registryManifests.ts'
import { messageFromError } from '../shared/messageFromError.ts'
import { buildPrompts } from './buildPrompts.ts'
import { buildTools } from './buildTools.ts'
import { callTool } from './callTool.ts'
import { getMcpResourceServer } from './mcpResourceServerSlot.ts'
import { renderPrompt } from './renderPrompt.ts'
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
Interpolates the caller's arguments into the prompt body and wraps the
result in the MCP prompts/get wire shape — a markdown prompt is a single
user message whose text is the rendered template. (The in-process agent
loop reaches the same prompts via mcpSurface().getPrompt, which returns
plain messages rather than this wire shape.)
*/
function getPrompt(
    name: string,
    args: Record<string, unknown> | undefined,
): Record<string, unknown> {
    const { description, messages } = renderPrompt(name, args)
    return {
        ...(description ? { description } : {}),
        messages: messages.map((message) => ({
            role: message.role,
            content: { type: 'text', text: message.text },
        })),
    }
}

/*
Parses a single JSON-RPC envelope and dispatches by method. Errors
become JSON-RPC error responses (the HTTP layer always returns 200 with
an envelope for JSON-RPC over HTTP; transport errors are different). The
tool/prompt derivation and tool dispatch live in mcpSurface — the same
projection the in-process agent loop builds on.
*/
export async function dispatchMcpRequest(
    request: Request,
    opts: McpServerOptions,
    serverInfo: { name: string; version: string },
): Promise<JsonRpcResponse | undefined> {
    let envelope: JsonRpcRequest
    try {
        envelope = (await request.clone().json()) as JsonRpcRequest
    } catch {
        return jsonRpcError(null, -32700, 'Parse error')
    }
    /* A notification has no `id` field at all (absent — `id: 0`/`id: null` are
       valid ids). JSON-RPC 2.0 forbids replying to a notification, so dispatch it
       for its side effect and return undefined to signal "no reply". */
    const isNotification = !('id' in envelope)
    const id = envelope.id ?? null
    if (envelope.jsonrpc !== '2.0' || typeof envelope.method !== 'string') {
        return isNotification ? undefined : jsonRpcError(id, -32600, 'Invalid Request')
    }

    // Run the method for its side effect, then drop the reply for a notification.
    const response = await dispatchMethod(envelope, id, request, opts, serverInfo)
    return isNotification ? undefined : response
}

/* Resolves a parsed, validated request to its JSON-RPC response. The caller
   discards this for notifications; non-notifications get it verbatim. */
async function dispatchMethod(
    envelope: JsonRpcRequest,
    id: string | number | null,
    request: Request,
    opts: McpServerOptions,
    serverInfo: { name: string; version: string },
): Promise<JsonRpcResponse> {
    if (opts.authorize) {
        try {
            await opts.authorize(request)
        } catch (error) {
            const message = messageFromError(error)
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
        const message = messageFromError(error)
        return jsonRpcError(id, -32603, message)
    }
}
