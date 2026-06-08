import type { McpSurface } from '../mcp/mcpSurface.ts'
import { mcpSurface } from '../mcp/mcpSurface.ts'
import { request } from './request.ts'

/*
The in-app agent surface. `agent(engine, messages)` runs a model engine
against the app's own MCP surface and returns the engine's frame stream —
it does NOT pick a transport. The handler wraps it in `jsonl()` or `sse()`,
so consumption is the app's choice, same as any other streaming verb:

  // src/server/rpc/chat.ts
  import { agent } from '@belte/belte/server/agent'
  import { jsonl } from '@belte/belte/server/jsonl'
  import { engine } from '@belte/anthropic'

  const chatEngine = engine({ model: 'claude-opus-4-8', apiKey: config.ANTHROPIC_API_KEY })
  export const chat = POST(({ messages }) => jsonl(agent(chatEngine, messages)), { inputSchema })

The engine — provider-specific, lives in a `@belte/<provider>` package —
only sees the surface in and yields frames out, so swapping providers never
touches the verb or the UI.

Permission is decided server-side, not negotiated at runtime: the surface
is already gated by each verb's `clients.mcp` declaration plus its own
per-call handler auth, and any provider built-ins (e.g. Claude Code's bash
tool) are fenced by static rules in the engine's config.
*/

// A turn in the conversation, provider-neutral. The engine maps these to its provider's wire shape.
export type NeutralMessage =
    | { role: 'user'; text: string }
    | {
          role: 'assistant'
          text?: string
          toolUses?: { id: string; name: string; input: unknown }[]
      }
    | { role: 'tool'; results: { id: string; content: string; isError?: boolean }[] }

// What the engine streams out; the handler frames it via jsonl()/sse() for the client.
export type AgentFrame =
    | { type: 'text'; delta: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: 'tool_result'; id: string; name: string; ok: boolean }
    | { type: 'done'; stop: 'end' | 'tool_use' | 'max_tokens' | 'refusal' }

// The app's tool/prompt/resource surface handed to an engine (already gated).
export type AgentSurface = McpSurface

/*
A model engine: surface + conversation in, frames out. It owns its own loop
(a raw-model tool loop, or driving a full agent harness) — core only sees
the frame stream. `origin` lets engines that reach the MCP endpoint over
HTTP address this server. Implementations live in `@belte/<provider>`
packages.
*/
export type AgentEngine = (input: {
    surface: AgentSurface
    messages: NeutralMessage[]
    origin: string
}) => AsyncIterable<AgentFrame>

/*
Runs an engine against the current request's MCP surface and returns its
AgentFrame stream. Must be called inside a verb's request scope —
mcpSurface() forwards the caller's auth into every tool dispatch. The
handler chooses the transport: `jsonl(agent(engine, messages))` or
`sse(agent(engine, messages))`.
*/
export function agent(engine: AgentEngine, messages: NeutralMessage[]): AsyncIterable<AgentFrame> {
    const inbound = request()
    return engine({
        surface: mcpSurface(inbound),
        messages,
        origin: new URL(inbound.url).origin,
    })
}
