// 44.9 — THE MESSAGES API AS A `Provider`, configured the way Anthropic documents it: the request
// body's own fields, snake_case, beside the client's `apiKey` and `baseURL`. abide owns `messages`
// and `stream`; every other field is laid on the body as written, and the `tools` written there —
// a server tool like web search — are sent beside the app's own.
//
// 44.2 — EVERY EVENT THE API STREAMS IS YIELDED AS IT ARRIVES, unchanged, and folded into the history
// the next run is sent by the one accumulator a page folds them with (44.105): so what a page holds
// after an answer is exactly what this sent — every block of an assistant turn as it came, a
// `thinking` block with its signature included, which a turn continuing after a tool call is refused
// without.

import type {
    AssistantContent,
    AssistantEvent,
    AssistantMessage,
} from '#shared/AssistantEvent.ts'
import { framedStream } from '#shared/framing.ts'
import { MessageAccumulator } from '#shared/MessageAccumulator.ts'
import { refuse } from '#shared/refuse.ts'

import { blocksOf, type Provider, toolBlocksOf } from './assistant.ts'

/** A Messages API request body, less what abide writes, with the client's key and origin. */
export type ClaudeApiConfig = {
    apiKey: string
    baseURL?: string | undefined
    model: string
    max_tokens: number
    system?: string | unknown[] | undefined
    tools?: unknown[] | undefined
    messages?: never | undefined
    stream?: never | undefined
    [field: string]: unknown
}

const API_URL = 'https://api.anthropic.com'
const API_VERSION = '2023-06-01'

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
            // 44.38 — every block in its place in its turn, a call and its result as they were.
            const history: AssistantMessage[] = []
            for (const message of messages)
                history.push({
                    role: message.role,
                    content: blocksOf(message.content),
                })
            const accumulator = new MessageAccumulator(history.length)
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
                let stop: string | null = null
                for await (const chunk of framedStream(answered.body, 'sse')) {
                    const event = chunk as
                        | AssistantEvent
                        | { type: 'error'; error: { message: string } }
                    // 44.21.
                    if (event.type === 'error')
                        throw refuse(
                            502,
                            `The Claude API failed: ${event.error.message}`,
                        )
                    if (event.type === 'message_delta')
                        stop = event.delta.stop_reason
                    accumulator.add(history, event)
                    yield event
                }
                // 44.9 — a run that did not stop for its calls, or the turn cap, ends the answer: a
                // call left unanswered is the cap's mark, and a call cut short is never run.
                if (stop !== 'tool_use' || turn >= maxTurns) return
                // The run's assistant message, which the accumulator opened with an array.
                const run = history[history.length - 1] as AssistantMessage
                const called: { id: string; name: string; input: unknown }[] =
                    []
                for (const block of run.content as AssistantContent[])
                    if (block.type === 'tool_use') called.push(block)
                const answers = await Promise.all(
                    called.map(async (call) => ({
                        id: call.id,
                        ...(await tools.call(call.name, call.input)),
                    })),
                )
                // 44.12, 44.35 — every result of one run in the one user message after it.
                for (const answer of answers) {
                    const result = {
                        type: 'tool_result' as const,
                        tool_use_id: answer.id,
                        content: toolBlocksOf(answer.content),
                        is_error: answer.isError,
                    }
                    accumulator.add(history, { ...result, value: undefined })
                    yield result
                }
            }
        },
    }
}
