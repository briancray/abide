import { dispatchRpcInProcess } from '../server/rpc/dispatchRpcInProcess.ts'
import { findRpcByCommandName } from '../server/rpc/findRpcByCommandName.ts'
import { socketOperations } from '../server/sockets/socketOperations.ts'
import { socketRegistry } from '../server/sockets/socketRegistry.ts'
import { forwardHeaders } from '../shared/forwardHeaders.ts'
import { messageFromError } from '../shared/messageFromError.ts'
import { toolResultFromResponse } from './toolResultFromResponse.ts'
import type { ToolResult } from './types/ToolResult.ts'

function textResult(text: string, isError = false): ToolResult {
    return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) }
}

/*
Dispatches the socket tail / publish tools by matching the tool name
against each mcp-exposed socket's operations (socketOperations is the same
projection tools/list advertised, so the publish op only exists when the
socket allows it). tail returns the retained tail (request/response
can't hold a live subscription); publish validates against the socket
schema and fans out. Returns undefined when the name isn't a known socket
tool so callTool can fall through to "unknown tool".
*/
function callSocketTool(
    toolName: string,
    args: Record<string, unknown> | undefined,
): ToolResult | undefined {
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
            const frames = entry.snapshotTail(count)
            return {
                content: [{ type: 'text', text: frames.map((f) => JSON.stringify(f)).join('\n') }],
                structuredContent: { frames },
            }
        }
        try {
            // broadcast() validates the payload against the socket schema and throws on failure.
            entry.socket.broadcast(args)
        } catch (error) {
            return textResult(messageFromError(error), true)
        }
        return textResult('ok')
    }
    return undefined
}

/*
Tool dispatch. RPC tools synthesize a Request (with forwarded auth
headers from `inbound`) and pipe it through rpc.fetch inside the request
scope — the same seam the HTTP router crosses, so validation, the handler,
and the request-scoped helpers (per-call cache(), cookies(), request())
behave identically. A handler throw is caught by the scope and framed as
an isError tool result (via the 500 response) rather than escaping. The
response (buffered or streaming) is framed by toolResultFromResponse.
Socket tools (`<base>-tail` / `<base>-publish`) fall through to the socket
dispatcher.
*/
export async function callTool(
    toolName: string,
    args: Record<string, unknown> | undefined,
    inbound: Request,
): Promise<ToolResult> {
    const entry = findRpcByCommandName(toolName)
    if (entry) {
        /* A rpc owns this name. If it isn't mcp-exposed it's still unavailable —
           don't fall through to a socket op that happens to share the name. */
        if (!entry.clients.mcp) {
            throw new Error(`unknown tool: ${toolName}`)
        }
        const response = await dispatchRpcInProcess({
            remote: entry.remote,
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
