// 44.9 — THE MESSAGES API AS A `Provider`, configured the way Anthropic documents it: the request
// body's own fields, snake_case, beside the client's `apiKey` and `baseURL`. abide owns `messages`
// and `stream`; every other field is laid on the body as written, and the `tools` written there —
// a server tool like web search — are sent beside the app's own.
//
// Every block of an assistant turn goes back as it came — a `thinking` block with its signature
// included, which a turn continuing after a tool call is refused without.

import type { AssistantEvent } from '#shared/AssistantEvent.ts'
import { framedStream } from '#shared/framing.ts'
import { refuse } from '#shared/refuse.ts'

import { blocksOf, type Provider, textOf, toolBlocksOf } from './assistant.ts'

/** A Messages API request body, less what abide writes, with the client's key and origin. */
export type ClaudeApiConfig = {
    apiKey: string
    baseURL?: string
    model: string
    max_tokens: number
    system?: string | unknown[]
    tools?: unknown[]
    messages?: never
    stream?: never
    [field: string]: unknown
}

const API_URL = 'https://api.anthropic.com'
const API_VERSION = '2023-06-01'

type Usage = Extract<AssistantEvent, { type: 'done' }>['usage']

/** A content block as the Messages API streams it, its fields filled in by the deltas that follow. */
type Block = {
    type: string
    id?: string
    name?: string
    input?: unknown
    text?: string
    citations?: Record<string, unknown>[] | null
    thinking?: string
    signature?: string
}

type ApiEvent = {
    type: string
    index: number
    message: { usage: Record<string, unknown> }
    content_block: Block
    // Each field is present on the delta whose `type` names it.
    delta: {
        type: string
        text: string
        citation: Record<string, unknown>
        partial_json: string
        thinking: string
        signature: string
        stop_reason: string | null
    }
    usage: Record<string, unknown> | undefined
    error: { message: string }
}

/** The Messages API, streamed, looping while Claude asks for tools. */
export function claudeApi(config: ClaudeApiConfig): Provider {
    // 44.10 — the key is the app's to hand over, and nothing reads one from the environment.
    if (typeof config.apiKey !== 'string' || config.apiKey === '')
        throw new Error(
            'abide: provider.claudeApi was handed no apiKey. RULEBOOK 44.10.',
        )
    const { apiKey, baseURL, tools: ownTools, ...body } = config
    return {
        async *run(messages, tools, { maxTurns, signal }) {
            const offered: unknown[] = [...(ownTools ?? [])]
            for (const tool of tools.list)
                offered.push({
                    name: tool.name,
                    description: tool.description,
                    input_schema: tool.inputSchema,
                })
            const history: { role: string; content: unknown }[] = []
            // 44.38 — every block in its place in its turn, a call and its result as they were.
            for (const message of messages)
                history.push({
                    role: message.role,
                    content: blocksOf(message.content),
                })
            // 44.11 — every request's usage summed, under the API's own names.
            const usage: Usage = { input_tokens: 0, output_tokens: 0 }
            for (let turn = 1; ; turn++) {
                const answered = await fetch(
                    `${baseURL ?? API_URL}/v1/messages`,
                    {
                        method: 'POST',
                        signal,
                        headers: {
                            'content-type': 'application/json',
                            'x-api-key': apiKey,
                            'anthropic-version': API_VERSION,
                        },
                        body: JSON.stringify({
                            ...body,
                            ...(offered.length === 0 ? {} : { tools: offered }),
                            stream: true,
                            messages: history,
                        }),
                    },
                )
                // 44.21 — the API's own failure, answered before the first event where it comes first.
                if (!answered.ok || answered.body === null)
                    throw refuse(
                        502,
                        `The Claude API answered ${answered.status}: ${await answered.text()}`,
                    )
                const blocks: Block[] = []
                const partials: string[] = []
                // How much of each text block's words have gone out as events.
                const shown: number[] = []
                const called: Block[] = []
                let used: Record<string, unknown> = {}
                let stop = 'end_turn'
                for await (const chunk of framedStream(answered.body, 'sse')) {
                    const event = chunk as ApiEvent
                    switch (event.type) {
                        case 'message_start':
                            used = { ...event.message.usage }
                            break
                        case 'content_block_start': {
                            const block = event.content_block
                            blocks[event.index] = block
                            partials[event.index] = ''
                            shown[event.index] = 0
                            // 44.28 — announced as the model starts writing it.
                            if (block.type === 'tool_use')
                                yield {
                                    type: 'tool',
                                    id: block.id as string,
                                    name: block.name as string,
                                }
                            break
                        }
                        case 'content_block_delta': {
                            const block = blocks[event.index] as Block
                            const delta = event.delta
                            if (delta.type === 'text_delta') {
                                block.text = (block.text ?? '') + delta.text
                                // 44.104 — a cited run goes out whole, once its block ends.
                                if (!cited(block)) {
                                    shown[event.index] = block.text.length
                                    yield { type: 'text', text: delta.text }
                                }
                            } else if (delta.type === 'citations_delta')
                                block.citations = [
                                    ...(block.citations ?? []),
                                    delta.citation,
                                ]
                            else if (delta.type === 'input_json_delta')
                                partials[event.index] =
                                    partials[event.index] + delta.partial_json
                            else if (delta.type === 'thinking_delta')
                                block.thinking =
                                    (block.thinking ?? '') + delta.thinking
                            else if (delta.type === 'signature_delta')
                                block.signature = delta.signature
                            break
                        }
                        case 'content_block_stop': {
                            const block = blocks[event.index] as Block
                            if (block.type === 'text' && cited(block)) {
                                yield {
                                    type: 'text',
                                    text: (block.text ?? '').slice(
                                        shown[event.index],
                                    ),
                                    citations: block.citations ?? [],
                                }
                                break
                            }
                            if (block.type !== 'tool_use') break
                            const partial = partials[event.index] as string
                            // Cut short at `max_tokens`, a call's input is not JSON — and that turn did
                            // not stop for `tool_use`, so it is never run (44.9).
                            try {
                                block.input =
                                    partial === '' ? {} : JSON.parse(partial)
                            } catch {
                                block.input = partial
                            }
                            called.push(block)
                            yield {
                                type: 'input',
                                id: block.id as string,
                                input: block.input,
                            }
                            break
                        }
                        case 'message_delta':
                            stop = event.delta.stop_reason ?? stop
                            // Cumulative for the message, so the last one stands for it.
                            Object.assign(used, event.usage)
                            break
                        case 'error':
                            // 44.21.
                            throw refuse(
                                502,
                                `The Claude API failed: ${event.error.message}`,
                            )
                    }
                }
                summed(usage, used)
                history.push({ role: 'assistant', content: blocks })
                if (stop !== 'tool_use' || turn >= maxTurns) {
                    yield {
                        type: 'done',
                        stop_reason: stop === 'tool_use' ? 'max_turns' : stop,
                        usage,
                    }
                    return
                }
                const answers = await Promise.all(
                    called.map(async (block) => ({
                        id: block.id as string,
                        ...(await tools.call(
                            block.name as string,
                            block.input,
                        )),
                    })),
                )
                const content: unknown[] = []
                for (const answer of answers) {
                    // 44.35 — the event carries the answer's words; an image goes to the model alone.
                    yield {
                        type: 'result',
                        tool_use_id: answer.id,
                        content: textOf(answer.content),
                        is_error: answer.failed,
                    }
                    content.push({
                        type: 'tool_result',
                        tool_use_id: answer.id,
                        content: toolBlocksOf(answer.content),
                        is_error: answer.failed,
                    })
                }
                // 44.12 — every result of one turn in one message.
                history.push({ role: 'user', content })
            }
        },
    }
}

/** Whether a text block cites: once a citation arrives, or where it started with a list for them. */
function cited(block: Block): boolean {
    return Array.isArray(block.citations)
}

/**
 * One request's usage added into the conversation's, field by field under the API's names: a count
 * summed, a record of counts summed member by member, and anything else as the last request said it.
 */
function summed(total: Usage, used: Record<string, unknown>): void {
    for (const field in used) {
        const value = used[field]
        const held = total[field]
        if (typeof value === 'number')
            total[field] = (typeof held === 'number' ? held : 0) + value
        else if (
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value)
        ) {
            const into: Record<string, unknown> =
                typeof held === 'object' && held !== null
                    ? (held as Record<string, unknown>)
                    : {}
            summed(into as Usage, value as Record<string, unknown>)
            total[field] = into
        } else total[field] = value
    }
}
