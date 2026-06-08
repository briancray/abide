import { query } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEngine } from '@belte/belte/server/agent'

/*
The Claude Code engine for belte's `agent()`. `engine(config)` returns an
AgentEngine that drives the Claude Agent SDK headless, pointed at the app's
own MCP endpoint, and relays its event stream as AgentFrames. Unlike the
raw-model engine, Claude Code owns its loop — core only sees frames out.

  // src/server/rpc/chat.ts
  import { agent } from '@belte/belte/server/agent'
  import { jsonl } from '@belte/belte/server/jsonl'
  import { engine } from '@belte/claude-code'
  const chatEngine = engine({ permission: { allow: ['mcp__app__*'], deny: ['Bash'] } })
  export const chat = POST(({ messages }) => jsonl(agent(chatEngine, messages)), { inputSchema })

Auth rides whatever Claude Code is logged in with (subscription or API key)
— no key in $server/config. Permission is decided server-side and static:
the app's tools are gated by the verb declaration; Claude Code's own
built-ins (Bash, file ops, web) are fenced by the deny/allow rules below.

NOTE: the @anthropic-ai/claude-agent-sdk message/option shapes are evolving
— verify `query`'s options (mcpServers, allowedTools, disallowedTools) and
the streamed message discriminants against the installed SDK version before
relying on this in production.
*/

type ClaudeCodeConfig = {
    // Static permission posture for Claude Code's own tools (not the app's — those are verb-gated).
    permission?: { allow?: string[]; deny?: string[] }
    // Bearer for the app's /__belte/mcp endpoint, if it's gated by app.handle/authorize.
    mcpToken?: string
    // MCP server name → tools surface as `mcp__<name>__<tool>`; defaults to "app".
    serverName?: string
}

export function engine(config: ClaudeCodeConfig = {}): AgentEngine {
    const serverName = config.serverName ?? 'app'
    return async function* ({ messages, origin }) {
        // Stateless: drive the latest user turn. Multi-turn continuity would use the SDK's
        // session resume (out of scope here) — see the stateless caveat in the design notes.
        const lastUser = [...messages].reverse().find((m) => m.role === 'user')
        const prompt = lastUser && lastUser.role === 'user' ? lastUser.text : ''

        const stream = query({
            prompt,
            options: {
                mcpServers: {
                    [serverName]: {
                        type: 'http',
                        url: `${origin}/__belte/mcp`,
                        ...(config.mcpToken
                            ? { headers: { Authorization: `Bearer ${config.mcpToken}` } }
                            : {}),
                    },
                },
                ...(config.permission?.allow ? { allowedTools: config.permission.allow } : {}),
                ...(config.permission?.deny ? { disallowedTools: config.permission.deny } : {}),
            },
        })

        for await (const message of stream) {
            if (message.type === 'assistant') {
                for (const block of message.message.content) {
                    if (block.type === 'text') {
                        yield { type: 'text', delta: block.text }
                    } else if (block.type === 'tool_use') {
                        yield {
                            type: 'tool_use',
                            id: block.id,
                            name: block.name,
                            input: block.input,
                        }
                    }
                }
            } else if (message.type === 'result') {
                yield { type: 'done', stop: 'end' }
            }
        }
    }
}
