import { afterAll, describe, expect, test } from 'bun:test'
import { assertAgentFrameConformance } from '@abide/abide/test/assertAgentFrameConformance'
import { createScriptedSurface } from '@abide/abide/test/createScriptedSurface'
import { engine } from '../src/engine.ts'

/*
Conformance of the Anthropic engine against the neutral AgentFrame contract,
driven hermetically: a scripted Messages API speaking the streaming SSE
protocol stands in for api.anthropic.com (via the engine's baseURL), and a
scripted surface records tool dispatches. Each test asserts the shared frame
invariants (assertAgentFrameConformance) plus the engine-specific mapping —
stop reasons, tool-loop wiring, conversation replay shapes.
*/

type FakeBlock =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }

type FakeTurn = {
    blocks: FakeBlock[]
    stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'pause_turn'
}

/* One scripted assistant turn rendered as the Messages API streaming event sequence. */
function sseFromTurn(turn: FakeTurn): string {
    const events: Array<[string, unknown]> = [
        [
            'message_start',
            {
                type: 'message_start',
                message: {
                    id: 'msg_fake',
                    type: 'message',
                    role: 'assistant',
                    model: 'fake-model',
                    content: [],
                    stop_reason: null,
                    stop_sequence: null,
                    usage: { input_tokens: 1, output_tokens: 0 },
                },
            },
        ],
    ]
    turn.blocks.forEach((block, index) => {
        if (block.type === 'text') {
            events.push([
                'content_block_start',
                { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
            ])
            /* Two deltas so the test proves live streaming, not buffered text. */
            const half = Math.ceil(block.text.length / 2)
            for (const piece of [block.text.slice(0, half), block.text.slice(half)]) {
                events.push([
                    'content_block_delta',
                    {
                        type: 'content_block_delta',
                        index,
                        delta: { type: 'text_delta', text: piece },
                    },
                ])
            }
        } else {
            events.push([
                'content_block_start',
                {
                    type: 'content_block_start',
                    index,
                    content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
                },
            ])
            events.push([
                'content_block_delta',
                {
                    type: 'content_block_delta',
                    index,
                    delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
                },
            ])
        }
        events.push(['content_block_stop', { type: 'content_block_stop', index }])
    })
    events.push([
        'message_delta',
        {
            type: 'message_delta',
            delta: { stop_reason: turn.stopReason, stop_sequence: null },
            usage: { output_tokens: 1 },
        },
    ])
    events.push(['message_stop', { type: 'message_stop' }])
    return events
        .map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
        .join('')
}

/*
Scripted Messages API: answers each POST with the next queued turn and
records the request bodies so a test can assert the conversation the engine
replayed (tool_use turns, tool_result content).
*/
function fakeMessagesApi(): {
    baseURL: string
    requests: Array<Record<string, unknown>>
    queue: FakeTurn[]
    stop: () => void
} {
    const requests: Array<Record<string, unknown>> = []
    const queue: FakeTurn[] = []
    const server = Bun.serve({
        port: 0,
        async fetch(req) {
            requests.push((await req.json()) as Record<string, unknown>)
            const turn = queue.shift()
            if (!turn) {
                return new Response('out of scripted turns', { status: 500 })
            }
            return new Response(sseFromTurn(turn), {
                headers: { 'Content-Type': 'text/event-stream' },
            })
        },
    })
    return {
        baseURL: `http://localhost:${server.port}`,
        requests,
        queue,
        stop: () => server.stop(true),
    }
}

const api = fakeMessagesApi()
afterAll(() => {
    api.stop()
})

function fakeEngine(maxSteps?: number) {
    return engine({ model: 'fake-model', apiKey: 'test', baseURL: api.baseURL, maxSteps })
}

const origin = 'http://localhost'
const userTurn = (text: string) => [{ role: 'user' as const, text }]

describe('anthropic engine conformance', () => {
    test('a text-only turn streams deltas and ends with done: end', async () => {
        api.queue.push({ blocks: [{ type: 'text', text: 'hello world' }], stopReason: 'end_turn' })
        const surface = createScriptedSurface()

        const { frames, done } = await assertAgentFrameConformance(
            fakeEngine()({ surface, messages: userTurn('hi'), origin }),
        )

        const text = frames
            .flatMap((frame) => (frame.type === 'text' ? [frame.delta] : []))
            .join('')
        expect(text).toBe('hello world')
        expect(done.stop).toBe('end')
        expect(surface.calls).toHaveLength(0)
    })

    test('a tool turn dispatches through the surface and replays the result', async () => {
        api.queue.push(
            {
                blocks: [
                    { type: 'text', text: 'using tool' },
                    { type: 'tool_use', id: 'tu_1', name: 'echo', input: { value: 'hi' } },
                ],
                stopReason: 'tool_use',
            },
            { blocks: [{ type: 'text', text: 'done' }], stopReason: 'end_turn' },
        )
        const surface = createScriptedSurface([
            {
                name: 'echo',
                result: (args) => ({ content: [{ type: 'text', text: `echo: ${args?.value}` }] }),
            },
        ])
        const requestsBefore = api.requests.length

        const { frames, done } = await assertAgentFrameConformance(
            fakeEngine()({ surface, messages: userTurn('use the tool'), origin }),
        )

        expect(surface.calls).toEqual([{ name: 'echo', args: { value: 'hi' } }])
        const toolFrames = frames.filter(
            (frame) => frame.type === 'tool_use' || frame.type === 'tool_result',
        )
        expect(toolFrames).toEqual([
            { type: 'tool_use', id: 'tu_1', name: 'echo', input: { value: 'hi' } },
            { type: 'tool_result', id: 'tu_1', name: 'echo', ok: true },
        ])
        expect(done.stop).toBe('end')

        /* The second request replays the tool round-trip in provider shape. */
        const secondBody = api.requests[requestsBefore + 1]
        const messages = secondBody.messages as Array<Record<string, unknown>>
        const toolResultTurn = messages[messages.length - 1]
        expect(toolResultTurn.role).toBe('user')
        expect(toolResultTurn.content).toEqual([
            { type: 'tool_result', tool_use_id: 'tu_1', content: 'echo: hi', is_error: false },
        ])
    })

    test('a failed tool result yields ok: false and replays is_error', async () => {
        api.queue.push(
            {
                blocks: [{ type: 'tool_use', id: 'tu_2', name: 'broken', input: {} }],
                stopReason: 'tool_use',
            },
            { blocks: [{ type: 'text', text: 'sorry' }], stopReason: 'end_turn' },
        )
        const surface = createScriptedSurface([
            {
                name: 'broken',
                result: () => ({ content: [{ type: 'text', text: 'nope' }], isError: true }),
            },
        ])
        const requestsBefore = api.requests.length

        const { frames } = await assertAgentFrameConformance(
            fakeEngine()({ surface, messages: userTurn('try'), origin }),
        )

        const result = frames.find((frame) => frame.type === 'tool_result')
        expect(result).toEqual({ type: 'tool_result', id: 'tu_2', name: 'broken', ok: false })
        const secondBody = api.requests[requestsBefore + 1]
        const messages = secondBody.messages as Array<Record<string, unknown>>
        const replayed = (
            messages[messages.length - 1].content as Array<Record<string, unknown>>
        )[0]
        expect(replayed.is_error).toBe(true)
    })

    test('the tool-loop cap stops with done: error instead of dispatching', async () => {
        api.queue.push({
            blocks: [{ type: 'tool_use', id: 'tu_3', name: 'echo', input: {} }],
            stopReason: 'tool_use',
        })
        const surface = createScriptedSurface([
            { name: 'echo', result: () => ({ content: [{ type: 'text', text: 'x' }] }) },
        ])

        const { frames, done } = await assertAgentFrameConformance(
            fakeEngine(1)({ surface, messages: userTurn('loop'), origin }),
        )

        expect(done.stop).toBe('error')
        expect(surface.calls).toHaveLength(0)
        /* Cap hit before dispatch: no tool_use frame was announced either. */
        expect(frames.filter((frame) => frame.type === 'tool_use')).toHaveLength(0)
    })

    test('refusal and max_tokens stop reasons map through', async () => {
        api.queue.push({ blocks: [], stopReason: 'refusal' })
        const refused = await assertAgentFrameConformance(
            fakeEngine()({ surface: createScriptedSurface(), messages: userTurn('no'), origin }),
        )
        expect(refused.done.stop).toBe('refusal')

        api.queue.push({ blocks: [{ type: 'text', text: 'tr' }], stopReason: 'max_tokens' })
        const truncated = await assertAgentFrameConformance(
            fakeEngine()({ surface: createScriptedSurface(), messages: userTurn('go'), origin }),
        )
        expect(truncated.done.stop).toBe('max_tokens')
    })
})
