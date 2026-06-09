import Anthropic from '@anthropic-ai/sdk'
import type { AgentEngine, AgentSurface, NeutralMessage } from '@belte/belte/server/agent'

/*
The Anthropic engine for belte's `agent()`. `engine(config)` returns an
AgentEngine: a manual tool loop over the Messages API that advertises the
app's gated tool surface, streams text frames live, dispatches tool calls
back through `surface.call`, and loops until the model stops asking for
tools.

  // src/server/rpc/chat.ts
  import { agent } from '@belte/belte/server/agent'
  import { jsonl } from '@belte/belte/server/jsonl'
  import { engine } from '@belte/anthropic'
  const chatEngine = engine({ model: 'claude-opus-4-8', apiKey: config.ANTHROPIC_API_KEY })
  export const chat = POST(({ messages }) => jsonl(agent(chatEngine, messages)), { inputSchema })

Adaptive thinking only, no sampling params — Opus 4.8/4.7 reject
temperature/top_p/budget_tokens. The app's tools are the only tools; the
surface is already gated by each verb's clients.mcp declaration, so there
are no provider built-ins to fence here.
*/

type AnthropicConfig = {
    model: string
    apiKey: string
    // Alternate Messages API origin — a gateway, a proxy, or a test double.
    baseURL?: string
    maxTokens?: number
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    // Hard cap on tool-loop turns so a model that never stops requesting tools can't
    // spin the loop (and the open stream) forever. Defaults to MAX_STEPS.
    maxSteps?: number
}

// Default tool-loop bound — generous enough for real multi-step tasks, finite enough to stop a runaway.
const MAX_STEPS = 24

// Provider stop_reason → the loop's neutral stop signal.
function mapStop(
    stopReason: Anthropic.Message['stop_reason'],
): 'end' | 'tool_use' | 'max_tokens' | 'refusal' {
    switch (stopReason) {
        case 'tool_use':
            return 'tool_use'
        case 'max_tokens':
            return 'max_tokens'
        case 'refusal':
            return 'refusal'
        default:
            return 'end'
    }
}

// Neutral conversation turn → Anthropic wire shape. System is handled separately (top-level), not here.
function toAnthropicMessage(message: NeutralMessage): Anthropic.MessageParam {
    if (message.role === 'user') {
        return { role: 'user', content: message.text }
    }
    if (message.role === 'assistant') {
        const content: Anthropic.ContentBlockParam[] = []
        if (message.text) {
            content.push({ type: 'text', text: message.text })
        }
        for (const toolUse of message.toolUses ?? []) {
            content.push({
                type: 'tool_use',
                id: toolUse.id,
                name: toolUse.name,
                input: toolUse.input as Record<string, unknown>,
            })
        }
        return { role: 'assistant', content }
    }
    return {
        role: 'user',
        content: message.results.map((result) => ({
            type: 'tool_result',
            tool_use_id: result.id,
            content: result.content,
            is_error: result.isError ?? false,
        })),
    }
}

function toAnthropicTool(tool: AgentSurface['tools'][number]): Anthropic.Tool {
    return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
    }
}

// Flattens an MCP tool result (text content blocks / structuredContent) to the string Anthropic expects.
function toolResultText(result: Record<string, unknown>): string {
    const content = result.content
    if (Array.isArray(content)) {
        return content
            .map((block) =>
                block && typeof block === 'object' && 'text' in block ? String(block.text) : '',
            )
            .join('')
    }
    return JSON.stringify(result.structuredContent ?? result)
}

export function engine(config: AnthropicConfig): AgentEngine {
    const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseURL })
    const maxSteps = config.maxSteps ?? MAX_STEPS
    return async function* ({ surface, messages }) {
        /*
        Drop turns that serialize to empty content — an assistant turn with no text
        and no tool uses, or a tool turn with no results. The Messages API rejects an
        empty content-block array, so a caller replaying such a turn would 400 the
        whole request.
        */
        const conversation: Anthropic.MessageParam[] = messages
            .map(toAnthropicMessage)
            .filter((message) => !(Array.isArray(message.content) && message.content.length === 0))
        const tools = surface.tools.map(toAnthropicTool)

        for (let step = 0; ; step += 1) {
            const stream = client.messages.stream({
                model: config.model,
                max_tokens: config.maxTokens ?? 64000,
                thinking: { type: 'adaptive' },
                ...(config.effort ? { output_config: { effort: config.effort } } : {}),
                tools,
                messages: conversation,
            })

            // Stream text live; defer tool inputs to the final message (already JSON-parsed there).
            for await (const event of stream) {
                if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                    yield { type: 'text', delta: event.delta.text }
                }
            }

            const final = await stream.finalMessage()
            conversation.push({ role: 'assistant', content: final.content })

            // Server paused a long-running turn: resume by re-requesting with the turn
            // so far rather than ending and truncating the output. The step cap bounds it.
            if (final.stop_reason === 'pause_turn' && step + 1 < maxSteps) {
                continue
            }
            if (final.stop_reason !== 'tool_use') {
                yield { type: 'done', stop: mapStop(final.stop_reason) }
                return
            }
            if (step + 1 >= maxSteps) {
                // Tool-loop cap hit: stop instead of dispatching another round.
                yield { type: 'done', stop: 'error' }
                return
            }

            const results: Anthropic.ToolResultBlockParam[] = []
            for (const block of final.content) {
                if (block.type !== 'tool_use') {
                    continue
                }
                yield { type: 'tool_use', id: block.id, name: block.name, input: block.input }
                const result = await surface.call(
                    block.name,
                    block.input as Record<string, unknown>,
                )
                const isError = result.isError === true
                yield { type: 'tool_result', id: block.id, name: block.name, ok: !isError }
                results.push({
                    type: 'tool_result',
                    tool_use_id: block.id,
                    content: toolResultText(result),
                    is_error: isError,
                })
            }
            conversation.push({ role: 'user', content: results })
        }
    }
}
