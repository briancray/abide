import type { Options, Settings } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEngine } from '@belte/belte/server/agent'
import { appMcpServers } from './appMcpServers.ts'
import { framesFromMessages } from './framesFromMessages.ts'
import { promptFromMessages } from './promptFromMessages.ts'
import type { StreamMessage } from './StreamMessage.ts'

/*
The SDK-backed Claude Code engine for belte's `agent()`. `engine(config)` returns
an AgentEngine that drives the @anthropic-ai/claude-agent-sdk headless, pointed at
the app's own MCP endpoint, and relays its event stream as AgentFrames.

  // src/server/rpc/chat.ts
  import { agent } from '@belte/belte/server/agent'
  import { jsonl } from '@belte/belte/server/jsonl'
  import { engine } from '@belte/claude-code'
  const chatEngine = engine({ permissions: { defaultMode: 'bypassPermissions' } })
  export const chat = POST(({ messages }) => jsonl(agent(chatEngine, messages)), { inputSchema })

Use this for a deployed server running Claude Code on its own auth, where there's
no interactive `claude` on PATH — it requires the @anthropic-ai/claude-agent-sdk
peer (which bundles its own runtime). For a local assistant against the user's
installed `claude` (the serve bridge / TUI), the cliEngine drives the binary
directly and needs no SDK.

Auth rides whatever Claude Code is logged in with. Permission is decided
server-side via `permissions` — the same `defaultMode` + allow/ask/deny block as
.claude/settings.json — governing how Claude Code treats its own built-ins.
*/
type ClaudeCodeConfig = {
    // Permission policy, forwarded to the SDK as inline settings + permissionMode.
    permissions?: Settings['permissions']
    // Built-in tools the model may see, or `[]` to drop them so only mcp__<app>__* remains.
    tools?: Options['tools']
    // Bearer for the app's /__belte/mcp endpoint, if it's gated by app.handle/authorize.
    mcpToken?: string
    // Cancels the run early; the engine also aborts when the consumer stops iterating.
    abortController?: AbortController
    // Escape hatch for any other SDK option; spread first so engine-owned keys win.
    options?: Partial<Options>
}

export function engine(config: ClaudeCodeConfig = {}): AgentEngine {
    /* Split the settings-shaped permission block: `defaultMode` is the session
    mode (a top-level SDK option, the only thing the bypass guard checks) while the
    allow/ask/deny rules ride in `settings.permissions`. */
    const { defaultMode, ...permissionRules } = config.permissions ?? {}
    return async function* ({ messages, origin }) {
        const prompt = promptFromMessages(messages)
        // The app's MCP server, keyed under its discovered `mcp__<name>__*` prefix.
        const appServers = await appMcpServers(origin, config.mcpToken)
        // Aborted in the finally so the SDK stops and kills its Claude process when
        // the consumer stops iterating; a caller controller can cancel from outside.
        const controller = config.abortController ?? new AbortController()

        const stream = query({
            prompt,
            options: {
                // No skills by default — a site-inline agent shouldn't surface the host's workflows.
                skills: [],
                // Caller extras first; every engine-owned key below overrides them.
                ...config.options,
                mcpServers: { ...config.options?.mcpServers, ...appServers },
                /* Isolate from the deploy host's ambient settings and MCP servers
                (project .mcp.json, user settings, plugins, cloud connectors) — they'd
                otherwise merge into and could widen this policy. */
                settingSources: [],
                strictMcpConfig: true,
                // Always stream token deltas (as stream_event) so text arrives live.
                includePartialMessages: true,
                abortController: controller,
                ...(config.tools ? { tools: config.tools } : {}),
                ...(Object.keys(permissionRules).length
                    ? { settings: { permissions: permissionRules } }
                    : {}),
                ...(defaultMode ? { permissionMode: defaultMode } : {}),
                // The SDK requires this explicit opt-in alongside bypassPermissions.
                ...(defaultMode === 'bypassPermissions'
                    ? { allowDangerouslySkipPermissions: true }
                    : {}),
            },
        })

        try {
            yield* framesFromMessages(stream as AsyncIterable<StreamMessage>)
        } finally {
            controller.abort()
        }
    }
}
