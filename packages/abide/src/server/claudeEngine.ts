// claudeEngine — a Claude/Anthropic `AgentEngine` (agent.md AG1). It normalizes the Anthropic
// Messages API streaming surface into abide's provider-neutral `AgentFrame` taxonomy so the
// provider-agnostic loop in agent.ts can drive it. One LLM turn per `stream()` call: it POSTs to
// `/v1/messages` with `stream: true`, parses the SSE event stream, and emits text/thinking deltas,
// tool-call frames, a usage frame, then `message-stop`. The loop — not the engine — decides `done`.
//
// Raw `fetch` + a hand-rolled SSE line parser keep this dependency-free and on web standards. Live
// use needs `ANTHROPIC_API_KEY` (or an explicit `apiKey`); the tests stub `fetch` entirely.

import { collectText, stringify } from './internal/agentText.ts'
import type {
    AgentEngine,
    AgentFrame,
    AgentOptions,
    AgentTool,
    NeutralContentPart,
    NeutralMessage,
} from './internal/agentTypes.ts'

const DEFAULT_MODEL = 'claude-sonnet-5'
const DEFAULT_BASE_URL = 'https://api.anthropic.com'
const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MAX_TOKENS = 4096

export function claudeEngine(
    opts: { apiKey?: string; model?: string; baseUrl?: string } = {},
): AgentEngine {
    return {
        stream(
            messages: NeutralMessage[],
            tools: AgentTool[],
            options: AgentOptions,
        ): AsyncIterable<AgentFrame> {
            return streamTurn(opts, messages, tools, options)
        },
    }
}

// One Anthropic message: `role` is always user|assistant (system is top-level; neutral `tool`
// messages become a user message carrying `tool_result` blocks). `content` is a plain string or an
// array of content blocks.
interface AnthropicMessage {
    role: 'user' | 'assistant'
    content: string | AnthropicBlock[]
}

// A content block sent to / mapped from the API. Superset of every block shape we emit; JSON
// serialization drops the fields that don't apply to a given `type`.
interface AnthropicBlock {
    type: string
    text?: string
    id?: string
    name?: string
    input?: unknown
    tool_use_id?: string
    content?: string
    is_error?: boolean
    source?: { type: 'base64'; media_type: string; data: string }
}

// A single decoded SSE event from the Messages stream. Only the fields we read are typed; the API
// sends more.
interface StreamEvent {
    type: string
    index?: number
    message?: { usage?: { input_tokens?: number; output_tokens?: number } }
    content_block?: { type: string; id?: string; name?: string }
    delta?: {
        type?: string
        text?: string
        thinking?: string
        partial_json?: string
        stop_reason?: string
    }
    usage?: { output_tokens?: number }
    error?: unknown
}

async function* streamTurn(
    opts: { apiKey?: string; model?: string; baseUrl?: string },
    messages: NeutralMessage[],
    tools: AgentTool[],
    options: AgentOptions,
): AsyncIterable<AgentFrame> {
    const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL
    const apiKey = opts.apiKey ?? Bun.env.ANTHROPIC_API_KEY ?? ''
    const { system, anthropicMessages } = toAnthropicMessages(messages, options.system)

    const body: Record<string, unknown> = {
        model: options.model ?? opts.model ?? DEFAULT_MODEL,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        stream: true,
        messages: anthropicMessages,
    }
    if (system !== undefined) body.system = system
    if (tools.length > 0) body.tools = toAnthropicTools(tools)

    let response: Response
    try {
        response = await fetch(`${baseUrl}/v1/messages`, {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': ANTHROPIC_VERSION,
                'content-type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: options.signal ?? null,
        })
    } catch (caught) {
        yield { type: 'error', error: caught }
        yield { type: 'message-stop' }
        return
    }

    if (!response.ok || response.body === null) {
        const detail = await response.text().catch(() => '')
        yield {
            type: 'error',
            error: new Error(`Anthropic API error ${response.status}: ${detail}`),
        }
        yield { type: 'message-stop' }
        return
    }

    // Accumulated tool-use state per content-block index: args JSON arrives across many
    // `input_json_delta`s and is only complete at `content_block_stop`.
    const toolBlocks = new Map<number, { id: string; name: string; json: string }>()
    let inputTokens = 0

    for await (const event of sseEvents(response.body)) {
        switch (event.type) {
            case 'message_start': {
                inputTokens = event.message?.usage?.input_tokens ?? 0
                yield { type: 'message-start' }
                break
            }
            case 'content_block_start': {
                const block = event.content_block
                if (block?.type === 'tool_use' && event.index !== undefined) {
                    toolBlocks.set(event.index, {
                        id: block.id ?? '',
                        name: block.name ?? '',
                        json: '',
                    })
                }
                break
            }
            case 'content_block_delta': {
                const delta = event.delta
                if (delta?.type === 'text_delta') {
                    yield { type: 'text-delta', text: delta.text ?? '' }
                } else if (delta?.type === 'thinking_delta') {
                    yield { type: 'thinking-delta', text: delta.thinking ?? '' }
                } else if (delta?.type === 'input_json_delta' && event.index !== undefined) {
                    const pending = toolBlocks.get(event.index)
                    if (pending !== undefined) pending.json += delta.partial_json ?? ''
                }
                break
            }
            case 'content_block_stop': {
                if (event.index !== undefined) {
                    const pending = toolBlocks.get(event.index)
                    if (pending !== undefined) {
                        toolBlocks.delete(event.index)
                        yield {
                            type: 'tool-call',
                            id: pending.id,
                            name: pending.name,
                            args: parseToolArgs(pending.json),
                        }
                    }
                }
                break
            }
            case 'message_delta': {
                if (event.usage !== undefined) {
                    yield {
                        type: 'usage',
                        input: inputTokens,
                        output: event.usage.output_tokens ?? 0,
                    }
                }
                break
            }
            case 'message_stop': {
                yield { type: 'message-stop' }
                break
            }
            case 'error': {
                yield { type: 'error', error: event.error }
                break
            }
        }
    }
}

// Parse the accumulated tool-args JSON. A zero-arg tool sends no `input_json_delta`, leaving an
// empty buffer — treat that as `{}`.
function parseToolArgs(json: string): unknown {
    const trimmed = json.trim()
    if (trimmed === '') return {}
    try {
        return JSON.parse(trimmed)
    } catch {
        return {}
    }
}

function toAnthropicTools(tools: AgentTool[]): AnthropicBlock[] {
    const out: AnthropicBlock[] = []
    for (const tool of tools) {
        out.push({
            type: 'custom',
            name: tool.name,
            // description/input_schema are the real wire fields; carried on the block object.
            ...(tool.description !== undefined ? { description: tool.description } : {}),
            input_schema: tool.inputSchema ?? { type: 'object', properties: {} },
        } as AnthropicBlock)
    }
    return out
}

// Map the neutral transcript to Anthropic's shape. System-role messages are pulled up into the
// top-level `system` string (joined with any `options.system`); `tool`-role messages become a user
// message of `tool_result` blocks.
function toAnthropicMessages(
    messages: NeutralMessage[],
    optionsSystem: string | undefined,
): { system: string | undefined; anthropicMessages: AnthropicMessage[] } {
    const systemParts: string[] = []
    if (optionsSystem !== undefined) systemParts.push(optionsSystem)
    const anthropicMessages: AnthropicMessage[] = []

    for (const message of messages) {
        if (message.role === 'system') {
            systemParts.push(collectText(message.content))
            continue
        }

        if (message.role === 'tool') {
            const blocks: AnthropicBlock[] = []
            if (typeof message.content !== 'string') {
                for (const part of message.content) {
                    if (part.type === 'tool-result') blocks.push(toolResultBlock(part))
                }
            }
            anthropicMessages.push({ role: 'user', content: blocks })
            continue
        }

        // user | assistant
        if (typeof message.content === 'string') {
            anthropicMessages.push({ role: message.role, content: message.content })
            continue
        }
        const blocks: AnthropicBlock[] = []
        for (const part of message.content) blocks.push(mapPart(part))
        anthropicMessages.push({ role: message.role, content: blocks })
    }

    return {
        system: systemParts.length > 0 ? systemParts.join('\n') : undefined,
        anthropicMessages,
    }
}

function mapPart(part: NeutralContentPart): AnthropicBlock {
    switch (part.type) {
        case 'text':
            return { type: 'text', text: part.text }
        case 'tool-use':
            return { type: 'tool_use', id: part.id, name: part.name, input: part.args }
        case 'tool-result':
            return toolResultBlock(part)
        case 'image':
            return {
                type: 'image',
                source: { type: 'base64', media_type: part.mime, data: part.data },
            }
    }
}

function toolResultBlock(part: {
    type: 'tool-result'
    id: string
    result: unknown
    error?: unknown
}): AnthropicBlock {
    if (part.error !== undefined) {
        return {
            type: 'tool_result',
            tool_use_id: part.id,
            content: stringify(part.error),
            is_error: true,
        }
    }
    return { type: 'tool_result', tool_use_id: part.id, content: stringify(part.result) }
}

// SSE line parser over the response body. Yields the JSON payload of each `data:` line; the parsed
// object's own `type` field carries the event name, so callers switch on that.
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
            const rawLine = buffer.slice(0, newlineIndex)
            buffer = buffer.slice(newlineIndex + 1)
            newlineIndex = buffer.indexOf('\n')
            const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
            if (!line.startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (data === '' || data === '[DONE]') continue
            try {
                yield JSON.parse(data) as StreamEvent
            } catch {
                // Ignore malformed SSE payloads rather than aborting the whole turn.
            }
        }
    }
}
