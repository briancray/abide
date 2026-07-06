import { dispatchRpcInProcess } from '../server/rpc/dispatchRpcInProcess.ts'
import { rpcRegistry } from '../server/rpc/rpcRegistry.ts'
import type { RpcRegistryEntry } from '../server/rpc/types/RpcRegistryEntry.ts'
import { socketOperations } from '../server/sockets/socketOperations.ts'
import { socketRegistry } from '../server/sockets/socketRegistry.ts'
import type { SocketOperation } from '../server/sockets/types/SocketOperation.ts'
import type { SocketRegistryEntry } from '../server/sockets/types/SocketRegistryEntry.ts'
import { commandNameForUrl } from '../shared/commandNameForUrl.ts'
import { forwardHeaders } from '../shared/forwardHeaders.ts'
import { jsonSchemaForSchema } from '../shared/jsonSchemaForSchema.ts'
import { messageFromError } from '../shared/messageFromError.ts'
import { annotationsForMethod } from './annotationsForMethod.ts'
import { toolResultFromResponse } from './toolResultFromResponse.ts'
import type { ToolDescriptor } from './types/ToolDescriptor.ts'
import type { ToolResult } from './types/ToolResult.ts'

/*
One MCP-exposed tool, resolved from the live registries: an rpc, or one of a
socket's operations. The ref carries the tool's identity (name) plus the
registry entry it projects from; the descriptor and the dispatch below are two
renderings of the same ref, so tools/list and tools/call can't disagree on
which tools exist or what they're called.
*/
type McpToolRef =
    | { kind: 'rpc'; name: string; entry: RpcRegistryEntry }
    | { kind: 'socket'; name: string; entry: SocketRegistryEntry; operation: SocketOperation }

/*
Enumerates the MCP tool namespace — the single decision of which tools exist.
RPCs with clients.mcp=true become one tool named after the export's URL
(folder segments joined with `-`; reads auto-expose while mutating rpcs
require an explicit clients.mcp — see resolveClientFlags). Sockets with
clients.mcp=true contribute a `<base>-tail` read tool and, when clientPublish
is set, a `<base>-publish` tool (existence + naming live in socketOperations).
RPCs enumerate first, so on a name collision the rpc tool wins.
*/
function mcpToolRefs(): McpToolRef[] {
    const refs: McpToolRef[] = []
    for (const entry of rpcRegistry.values()) {
        if (!entry.clients.mcp) {
            continue
        }
        refs.push({ kind: 'rpc', name: commandNameForUrl(entry.remote.url), entry })
    }
    for (const entry of socketRegistry.values()) {
        if (!entry.clients.mcp) {
            continue
        }
        for (const operation of socketOperations(entry)) {
            refs.push({ kind: 'socket', name: operation.name, entry, operation })
        }
    }
    return refs
}

/*
The advertised face of one tool. An rpc tool's description favours the
schema's top-level description (the vendor's JSON Schema conversion carries
`.describe(...)` through), falling back to `method url` so the tool is still
labelled when the schema has none; the HTTP method feeds the annotations
(readOnlyHint / destructiveHint / idempotentHint) so a model can tell a read
from a write.
*/
function describeTool(ref: McpToolRef): ToolDescriptor {
    if (ref.kind === 'rpc') {
        const inputSchema = jsonSchemaForSchema(ref.entry.inputSchema)
        const tool: ToolDescriptor = {
            name: ref.name,
            description:
                (inputSchema.description as string | undefined) ??
                `${ref.entry.remote.method} ${ref.entry.remote.url}`,
            inputSchema,
            annotations: annotationsForMethod(ref.entry.remote.method),
        }
        if (ref.entry.outputSchema) {
            tool.outputSchema = jsonSchemaForSchema(ref.entry.outputSchema)
        }
        return tool
    }
    const payloadSchema = jsonSchemaForSchema(ref.entry.schema)
    if (ref.operation.kind === 'tail') {
        return {
            name: ref.name,
            description: `Read recent messages from the "${ref.operation.socketName}" socket`,
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
        }
    }
    return {
        name: ref.name,
        description: `Publish a message to the "${ref.operation.socketName}" socket`,
        inputSchema: payloadSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    }
}

function textResult(text: string, isError = false): ToolResult {
    return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) }
}

/*
Dispatches an rpc tool by synthesizing a Request (with forwarded auth headers
from `inbound`) and piping it through rpc.fetch inside the request scope — the
same seam the HTTP router crosses, so validation, the handler, and the
request-scoped helpers (per-call cache(), cookies(), request()) behave
identically. A handler throw is caught by the scope and framed as an isError
tool result (via the 500 response) rather than escaping. The response
(buffered or streaming) is framed by toolResultFromResponse.
*/
async function callRpcTool(
    entry: RpcRegistryEntry,
    args: Record<string, unknown> | undefined,
    inbound: Request,
): Promise<ToolResult> {
    const response = await dispatchRpcInProcess({
        remote: entry.remote,
        args,
        baseUrl: `${new URL(inbound.url).origin}/`,
        headers: forwardHeaders(inbound.headers),
    })
    return toolResultFromResponse(response)
}

/*
Dispatches a socket tool. tail returns the retained tail (request/response
can't hold a live subscription); publish validates against the socket schema
and fans out.
*/
function callSocketTool(
    entry: SocketRegistryEntry,
    operation: SocketOperation,
    args: Record<string, unknown> | undefined,
): Promise<ToolResult> | ToolResult {
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

/*
The MCP tool surface: what tools/list advertises and what tools/call runs.
Both faces render from mcpToolRefs — the tool namespace is decided once, so
everything advertised is callable and everything callable is advertised.
list() is the only face that builds descriptors (schema projection is
per-call work dispatch never pays). Read at call time (not cached) so rpcs
constructed after boot show up, matching the other registry projections.
*/
export const mcpTools = {
    list(): ToolDescriptor[] {
        return mcpToolRefs().map(describeTool)
    },
    async call(
        toolName: string,
        args: Record<string, unknown> | undefined,
        inbound: Request,
    ): Promise<ToolResult> {
        for (const ref of mcpToolRefs()) {
            if (ref.name !== toolName) {
                continue
            }
            return ref.kind === 'rpc'
                ? callRpcTool(ref.entry, args, inbound)
                : callSocketTool(ref.entry, ref.operation, args)
        }
        throw new Error(`unknown tool: ${toolName}`)
    },
}
