import { afterEach, describe, expect, test } from 'bun:test'
import { agent } from './agent.ts'
import { claudeEngine } from './claudeEngine.ts'
import type { AgentFrame, AgentTool, NeutralMessage } from './internal/agentTypes.ts'

async function collect(stream: AsyncIterable<AgentFrame>): Promise<AgentFrame[]> {
    const frames: AgentFrame[] = []
    for await (const frame of stream) frames.push(frame)
    return frames
}

function user(text: string): NeutralMessage {
    return { role: 'user', content: text }
}

type StreamEvent = { type: string } & Record<string, unknown>

// Build a canned Anthropic SSE `Response` from a list of stream events (one SSE frame each).
function sseResponse(events: StreamEvent[]): Response {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const event of events) {
                controller.enqueue(
                    encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
                )
            }
            controller.close()
        },
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

// Stub `fetch` to hand back one queued response per call (one per LLM turn).
function stubFetch(responses: Response[]): typeof fetch {
    let index = 0
    return (async () => {
        const response = responses[index]
        index++
        if (response === undefined) throw new Error('stubFetch: no more queued responses')
        return response
    }) as unknown as typeof fetch
}

// A documented turn: two text deltas, then a tool_use block whose args stream in as input_json.
const TEXT_THEN_TOOL: StreamEvent[] = [
    { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world' } },
    { type: 'content_block_stop', index: 0 },
    {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'get_weather' },
    },
    {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"city":' },
    },
    {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '"Paris"}' },
    },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 25 } },
    { type: 'message_stop' },
]

// Turn 1 of the loop: only a tool_use.
const TURN_TOOL_ONLY: StreamEvent[] = [
    { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } },
    {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'get_weather' },
    },
    {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"city":"Paris"}' },
    },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8 } },
    { type: 'message_stop' },
]

// Turn 2 of the loop: plain text, no tools → the loop settles to `done`.
const TURN_TEXT_ONLY: StreamEvent[] = [
    { type: 'message_start', message: { usage: { input_tokens: 30, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'It is sunny in Paris.' },
    },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 15 } },
    { type: 'message_stop' },
]

describe('claudeEngine', () => {
    const originalFetch = globalThis.fetch
    afterEach(() => {
        globalThis.fetch = originalFetch
    })

    test('normalizes a canned Anthropic SSE stream into frames', async () => {
        globalThis.fetch = stubFetch([sseResponse(TEXT_THEN_TOOL)])
        const tool: AgentTool = { name: 'get_weather', run: () => 'sunny' }

        const frames = await collect(claudeEngine().stream([user('weather in Paris?')], [tool], {}))

        // Text deltas arrive with the right text, in order.
        const textDeltas = frames.filter((f) => f.type === 'text-delta')
        expect(textDeltas).toEqual([
            { type: 'text-delta', text: 'Hello ' },
            { type: 'text-delta', text: 'world' },
        ])

        // The tool_use block is finalized into one tool-call frame with parsed args + name.
        const toolCall = frames.find((f) => f.type === 'tool-call')
        expect(toolCall).toEqual({
            type: 'tool-call',
            id: 'toolu_1',
            name: 'get_weather',
            args: { city: 'Paris' },
        })

        // Usage combines message_start input tokens with message_delta output tokens.
        const usage = frames.find((f) => f.type === 'usage')
        expect(usage).toEqual({ type: 'usage', input: 10, output: 25 })

        // The turn boundary is emitted.
        expect(frames.some((f) => f.type === 'message-stop')).toBe(true)
    })

    test('emits an error frame on an HTTP error response', async () => {
        globalThis.fetch = stubFetch([new Response('bad request', { status: 400 })])

        const frames = await collect(claudeEngine().stream([user('hi')], [], {}))

        const error = frames.find((f) => f.type === 'error')
        expect(error).toBeDefined()
        expect((error as { error?: unknown }).error).toBeInstanceOf(Error)
    })

    test('agent() drives a full two-turn tool loop to done', async () => {
        let ranArgs: unknown
        const tool: AgentTool = {
            name: 'get_weather',
            run: (args: unknown): string => {
                ranArgs = args
                return 'sunny'
            },
        }

        // Turn 1 asks for the tool; turn 2 answers in text.
        globalThis.fetch = stubFetch([sseResponse(TURN_TOOL_ONLY), sseResponse(TURN_TEXT_ONLY)])

        const frames = await collect(
            agent(claudeEngine(), [user('weather in Paris?')], { tools: [tool] }),
        )

        // The model's tool call ran with the parsed args.
        expect(ranArgs).toEqual({ city: 'Paris' })

        // The loop surfaced the tool call, its result, the follow-up text, and finished.
        expect(frames.some((f) => f.type === 'tool-call')).toBe(true)
        const toolResult = frames.find((f) => f.type === 'tool-result')
        expect(toolResult).toEqual({ type: 'tool-result', id: 'toolu_1', result: 'sunny' })
        expect(frames.some((f) => f.type === 'text-delta')).toBe(true)
        expect(frames[frames.length - 1]).toEqual({ type: 'done' })
    })
})
