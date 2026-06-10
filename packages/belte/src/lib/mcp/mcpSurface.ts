import { promptRegistry } from '../server/prompts/promptRegistry.ts'
import { dispatchVerbInProcess } from '../server/rpc/dispatchVerbInProcess.ts'
import { findVerbByCommandName } from '../server/rpc/findVerbByCommandName.ts'
import { verbRegistry } from '../server/rpc/verbRegistry.ts'
import { socketOperations } from '../server/sockets/socketOperations.ts'
import { socketRegistry } from '../server/sockets/socketRegistry.ts'
import { commandNameForUrl } from '../shared/commandNameForUrl.ts'
import { forwardHeaders } from '../shared/forwardHeaders.ts'
import { jsonSchemaForSchema } from '../shared/jsonSchemaForSchema.ts'
import { annotationsForMethod } from './annotationsForMethod.ts'
import { getMcpResourceServer } from './mcpResourceServerSlot.ts'
import { toolResultFromResponse } from './toolResultFromResponse.ts'
import type { McpResourceContents } from './types/McpResourceContents.ts'
import type { McpResourceDescriptor } from './types/McpResourceDescriptor.ts'

/*
The app's MCP surface, projected for in-process consumers. This is the single
source of truth dispatchMcpRequest (the JSON-RPC-over-HTTP transport) and the
in-app agent loop (belte/server/agent) both build on — the same tool/prompt/
resource derivation, so a model reaching the app over HTTP and a model driven
in-process can't drift on what's exposed.

Internal: there is no package export. The public entry is `agent()`, which
calls `mcpSurface(request)` to hand an engine the gated tool set.
*/

export type ToolDescriptor = {
    name: string
    description: string
    inputSchema: Record<string, unknown>
    outputSchema?: Record<string, unknown>
    annotations?: Record<string, boolean>
}

export type PromptDescriptor = {
    name: string
    description?: string
    arguments: Array<{ name: string; description?: string; required: boolean }>
}

// The MCP tools/call result shape (a text content block plus optional structuredContent).
export type ToolResult = Record<string, unknown>

// A prompt rendered to plain messages — the user turn(s) that seed a conversation.
export type PromptMessage = { role: 'user'; text: string }

export type McpSurface = {
    tools: ToolDescriptor[]
    call(name: string, args: Record<string, unknown> | undefined): Promise<ToolResult>
    prompts: PromptDescriptor[]
    getPrompt(name: string, args?: Record<string, unknown>): PromptMessage[]
    listResources(): Promise<McpResourceDescriptor[]>
    readResource(uri: string): Promise<McpResourceContents | undefined>
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
export function buildTools(): ToolDescriptor[] {
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
framework interpolates them into the body on getPrompt.
*/
export function buildPrompts(): PromptDescriptor[] {
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
Tool dispatch. RPC tools synthesize a Request (with forwarded auth
headers from `inbound`) and pipe it through verb.fetch inside the request
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

/*
Renders a prompt: looks it up, interpolates the caller's args, and returns its
optional description plus the message(s) that seed a conversation. A markdown
prompt is a single user turn whose text is the interpolated template. Throws on
an unknown prompt name. The one place prompt rendering lives — dispatchMcpRequest
wraps this in the prompts/get wire shape, the agent loop reads the messages plain.
*/
export function renderPrompt(
    name: string,
    args?: Record<string, unknown>,
): { description?: string; messages: PromptMessage[] } {
    const entry = promptRegistry.get(name)
    if (!entry) {
        throw new Error(`unknown prompt: ${name}`)
    }
    return {
        ...(entry.prompt.description ? { description: entry.prompt.description } : {}),
        messages: [
            { role: 'user', text: entry.prompt.render((args ?? {}) as Record<string, string>) },
        ],
    }
}

// The conversation-seeding messages for a prompt, without the wire-shape wrapping.
export function getPromptMessages(name: string, args?: Record<string, unknown>): PromptMessage[] {
    return renderPrompt(name, args).messages
}

/*
Projects the app's MCP surface for an in-process consumer bound to `request`
— tool calls forward that request's auth headers into the verb handler, so
the model acts with the caller's identity. Used by `agent()`.
*/
export function mcpSurface(request: Request): McpSurface {
    // Built on first read and memoized: an engine that advertises tools but never
    // reads prompts (or reaches tools over HTTP, reading neither) skips the unused build.
    let tools: ToolDescriptor[] | undefined
    let prompts: PromptDescriptor[] | undefined
    return {
        get tools() {
            tools ??= buildTools()
            return tools
        },
        get prompts() {
            prompts ??= buildPrompts()
            return prompts
        },
        call: (name, args) => callTool(name, args, request),
        getPrompt: getPromptMessages,
        async listResources() {
            const server = getMcpResourceServer()
            return server ? server.list() : []
        },
        async readResource(uri) {
            const server = getMcpResourceServer()
            return server ? server.read(uri) : undefined
        },
    }
}
