import type { Options, Settings } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEngine, NeutralMessage } from '@belte/belte/server/agent'
import { appMcpServers } from './appMcpServers.ts'

/*
The Claude Code engine for belte's `agent()`. `engine(config)` returns an
AgentEngine that drives the Claude Agent SDK headless, pointed at the app's
own MCP endpoint, and relays its event stream as AgentFrames. Unlike the
raw-model engine, Claude Code owns its loop — core only sees frames out.

  // src/server/rpc/chat.ts
  import { agent } from '@belte/belte/server/agent'
  import { jsonl } from '@belte/belte/server/jsonl'
  import { engine } from '@belte/claude-code'
  const chatEngine = engine({ permissions: { defaultMode: 'bypassPermissions' } })
  export const chat = POST(({ messages }) => jsonl(agent(chatEngine, messages)), { inputSchema })

Auth rides whatever Claude Code is logged in with (subscription or API key)
— no key in $server/config. Permission is decided server-side via
`permissions` — the same `defaultMode` + `allow`/`ask`/`deny` block as
.claude/settings.json. The app's own tools are already gated by each verb's
declaration, so this governs how Claude Code treats its own built-ins
(which ops auto-run, prompt, plan-only, or are blocked).

NOTE: the @anthropic-ai/claude-agent-sdk message/option shapes are evolving
— verify `query`'s options (mcpServers, settings.permissions, permissionMode) and the streamed
message discriminants against the installed SDK version before relying on
this in production.
*/

type ClaudeCodeConfig = {
    /*
    The session's permission policy, forwarded to the SDK as inline settings.
    Same shape as .claude/settings.json's `permissions`: a `defaultMode`
    (`'default'` prompts on dangerous ops, `'acceptEdits'`, `'plan'` no tool
    execution, `'dontAsk'`, `'bypassPermissions'`) plus `allow`/`ask`/`deny`
    rule lists (e.g. `deny: ['Bash(rm:*)']`). `defaultMode:
    'bypassPermissions'` auto-wires the SDK's required
    `allowDangerouslySkipPermissions` flag — only for a fully trusted,
    non-interactive server.
    */
    permissions?: Settings['permissions']
    /*
    The base set of built-in tools the model may see — `['Read', 'Bash', …]`,
    or `[]` to drop every built-in so only the app's `mcp__<app>__*` verbs
    remain. This removes tools from context entirely (cheaper, and the
    model can't try them), a harder cut than a `permissions.deny` rule. Omit to
    keep the default Claude Code tool preset.
    */
    tools?: Options['tools']
    // Bearer for the app's /__belte/mcp endpoint, if it's gated by app.handle/authorize.
    mcpToken?: string
    /*
    Cancels the run early. The engine also aborts when the consumer stops
    iterating (break / HTTP disconnect), so passing one is only needed to cancel
    proactively from outside the loop — e.g. the serve bridge aborting on socket
    close, so the spawned Claude process dies with the page rather than running on.
    */
    abortController?: AbortController
    /*
    Escape hatch for any other SDK option (`model`, `maxTurns`, `systemPrompt`,
    `agents`, `env`, …). Spread first, so the engine-owned keys — the MCP
    wiring, `settingSources` isolation, and the bypass guard — always win;
    `mcpServers` is merged, so extra servers add to (not replace) the app's.
    */
    options?: Partial<Options>
}

/*
The SDK's `query` takes a single prompt (or a stream of user-only turns) and owns
assistant/tool turns through its own session, which belte doesn't resume here. So
prior turns are flattened into the prompt as a labelled transcript rather than
dropped — the model keeps the conversation's context without SDK session state.
A lone user turn passes through as its bare text. Tool-result turns are internal
to the prior run and omitted.
*/
function promptFromMessages(messages: NeutralMessage[]): string {
    if (messages.length === 1 && messages[0]?.role === 'user') {
        return messages[0].text
    }
    return messages
        .map((message) => {
            if (message.role === 'user') {
                return `User: ${message.text}`
            }
            if (message.role === 'assistant' && message.text) {
                return `Assistant: ${message.text}`
            }
            return ''
        })
        .filter(Boolean)
        .join('\n\n')
}

export function engine(config: ClaudeCodeConfig = {}): AgentEngine {
    /* Split the settings-shaped permission block: `defaultMode` is the session
    mode — a top-level SDK option, and the only thing the bypass guard checks —
    while the allow/ask/deny rules ride in `settings.permissions`. Routing the
    mode to one place avoids declaring it twice. */
    const { defaultMode, ...permissionRules } = config.permissions ?? {}
    return async function* ({ messages, origin }) {
        const prompt = promptFromMessages(messages)

        /* The app's MCP server, keyed under its discovered `mcp__<name>__*` prefix;
        a second belte app can still be merged via config.options.mcpServers under
        its own discovered name. */
        const appServers = await appMcpServers(origin, config.mcpToken)

        /* Aborted in the finally below so the SDK stops and kills the spawned
        Claude process when the consumer stops iterating; a caller-supplied
        controller also lets the run be cancelled from outside the loop. */
        const controller = config.abortController ?? new AbortController()

        const stream = query({
            prompt,
            options: {
                /* Expose no skills by default — a site-inline agent shouldn't surface
                the host's dev workflows, and the skill *listing* rides in the system
                prompt independently of `tools`/`settingSources`. Before the spread, so
                a caller can opt back in via `options.skills`. */
                skills: [],
                // Caller extras first; every engine-owned key below overrides them.
                ...config.options,
                mcpServers: {
                    ...config.options?.mcpServers,
                    ...appServers,
                },
                /* The engine's config is the authoritative permission source, so
                isolate from the deploy host's ~/.claude and project settings —
                they'd otherwise merge into (and could widen) this policy. */
                settingSources: [],
                /* Only the MCP servers passed above (the app, plus any the caller
                merged via options.mcpServers) — never the deploy user's ambient
                servers: project .mcp.json, user settings, plugins, and claude.ai
                cloud connectors (Gmail/Calendar/Drive). Without this they leak in. */
                strictMcpConfig: true,
                /* Always stream token deltas (as `stream_event` messages) so text
                arrives live, not buffered into one frame per turn — parity with
                the @belte/anthropic engine. After the spread, so it can't be
                disabled via config.options. */
                includePartialMessages: true,
                // Engine-owned (after the spread) so the finally-abort always has a handle.
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

        // tool_use id → name, so a tool_result (which carries only the id) can name its call.
        const toolNames = new Map<string, string>()
        try {
            for await (const message of stream) {
                if (message.type === 'stream_event') {
                    /* Live text deltas. The complete `assistant` message below repeats
                this text in full, so text is emitted only here to avoid a double
                send; that message is kept solely for its fully-formed tool_use
                blocks (partial tool inputs mid-stream aren't valid JSON yet). */
                    const event = message.event
                    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                        yield { type: 'text', delta: event.delta.text }
                    }
                } else if (message.type === 'assistant') {
                    for (const block of message.message.content) {
                        if (block.type === 'tool_use') {
                            toolNames.set(block.id, block.name)
                            yield {
                                type: 'tool_use',
                                id: block.id,
                                name: block.name,
                                input: block.input,
                            }
                        }
                    }
                } else if (message.type === 'user') {
                    /* Tool outcomes return as tool_result blocks on a user turn — successes
                and denials alike (a `dontAsk`/deny rejection is an `is_error` result). So
                `ok: !is_error` surfaces a blocked tool the same way as a failed one. */
                    const content = message.message.content
                    if (Array.isArray(content)) {
                        for (const block of content) {
                            if (block.type === 'tool_result') {
                                yield {
                                    type: 'tool_result',
                                    id: block.tool_use_id,
                                    name: toolNames.get(block.tool_use_id) ?? '',
                                    ok: !block.is_error,
                                }
                            }
                        }
                    }
                } else if (message.type === 'result') {
                    // `success` is a clean finish; every error subtype (max_turns, budget,
                    // execution error) is an abnormal stop the client must be able to see.
                    yield { type: 'done', stop: message.subtype === 'success' ? 'end' : 'error' }
                }
            }
        } finally {
            controller.abort()
        }
    }
}
