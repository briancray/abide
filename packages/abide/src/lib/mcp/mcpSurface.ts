import { abideLog } from '../shared/abideLog.ts'
import { buildPrompts } from './buildPrompts.ts'
import { getMcpResourceServer } from './mcpResourceServerSlot.ts'
import { mcpTools } from './mcpTools.ts'
import { renderPrompt } from './renderPrompt.ts'
import type { McpSurface } from './types/McpSurface.ts'
import type { PromptDescriptor } from './types/PromptDescriptor.ts'
import type { ToolDescriptor } from './types/ToolDescriptor.ts'

/*
The app's MCP surface, projected for in-process consumers. This is the single
source of truth dispatchMcpRequest (the JSON-RPC-over-HTTP transport) and the
in-app agent loop (abide/server/agent) both build on — the same tool/prompt/
resource derivation, so a model reaching the app over HTTP and a model driven
in-process can't drift on what's exposed. The individual derivations live in
sibling modules (mcpTools / buildPrompts / renderPrompt).

Internal: there is no package export. The public entry is `agent()`, which
calls `mcpSurface(request)` to hand an engine the gated tool set.
*/

/* MCP tool-dispatch spans, opt-in via DEBUG=abide:mcp — a model's tool call,
   wrapping the underlying rpc dispatch in the same trace. */
const mcpLog = abideLog.channel('abide:mcp')

/*
Projects the app's MCP surface for an in-process consumer bound to `request`
— tool calls forward that request's auth headers into the rpc handler, so
the model acts with the caller's identity. Used by `agent()`.
*/
export function mcpSurface(request: Request): McpSurface {
    // Built on first read and memoized: an engine that advertises tools but never
    // reads prompts (or reaches tools over HTTP, reading neither) skips the unused build.
    let tools: ToolDescriptor[] | undefined
    let prompts: PromptDescriptor[] | undefined
    return {
        get tools() {
            tools ??= mcpTools.list()
            return tools
        },
        get prompts() {
            prompts ??= buildPrompts()
            return prompts
        },
        call: (name, args) => mcpLog.trace(`mcp ${name}`, () => mcpTools.call(name, args, request)),
        /* The conversation-seeding messages, without the wire-shape wrapping. */
        getPrompt: (name, args) => renderPrompt(name, args).messages,
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
