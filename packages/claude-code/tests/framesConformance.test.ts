import { describe, expect, test } from 'bun:test'
import { assertAgentFrameConformance } from '@abide/abide/test/assertAgentFrameConformance'
import { framesFromMessages } from '../src/framesFromMessages.ts'
import type { StreamMessage } from '../src/StreamMessage.ts'

/*
Conformance of the Claude Code frame mapping against the neutral AgentFrame
contract. framesFromMessages is the engine's whole mapping layer (the SDK
query() stream and the CLI's stream-json lines share its schema), so scripted
StreamMessage sequences exercise everything except the SDK process wiring —
which needs a live Claude binary and stays out of CI. The same invariants the
Anthropic engine passes (assertAgentFrameConformance) run here, so the two
engines can't drift on the frame protocol.
*/

async function* scripted(messages: StreamMessage[]): AsyncIterable<StreamMessage> {
    yield* messages
}

const textDelta = (text: string): StreamMessage => ({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
})

describe('claude-code frame conformance', () => {
    test('a text-only run streams deltas and ends with done: end', async () => {
        const { frames, done } = await assertAgentFrameConformance(
            framesFromMessages(
                scripted([
                    textDelta('hello '),
                    textDelta('world'),
                    {
                        type: 'assistant',
                        message: { content: [{ type: 'text' }] },
                    },
                    { type: 'result', subtype: 'success' },
                ]),
            ),
        )
        const text = frames
            .flatMap((frame) => (frame.type === 'text' ? [frame.delta] : []))
            .join('')
        expect(text).toBe('hello world')
        expect(done.stop).toBe('end')
    })

    test('a tool round-trip pairs tool_use with its named tool_result', async () => {
        const { frames } = await assertAgentFrameConformance(
            framesFromMessages(
                scripted([
                    {
                        type: 'assistant',
                        message: {
                            content: [
                                { type: 'tool_use', id: 'tu_1', name: 'echo', input: { v: 1 } },
                            ],
                        },
                    },
                    {
                        type: 'user',
                        message: {
                            content: [
                                { type: 'tool_result', tool_use_id: 'tu_1', is_error: false },
                            ],
                        },
                    },
                    { type: 'result', subtype: 'success' },
                ]),
            ),
        )
        const toolFrames = frames.filter(
            (frame) => frame.type === 'tool_use' || frame.type === 'tool_result',
        )
        expect(toolFrames).toEqual([
            { type: 'tool_use', id: 'tu_1', name: 'echo', input: { v: 1 } },
            { type: 'tool_result', id: 'tu_1', name: 'echo', ok: true },
        ])
    })

    test('a blocked or failed tool surfaces ok: false', async () => {
        const { frames } = await assertAgentFrameConformance(
            framesFromMessages(
                scripted([
                    {
                        type: 'assistant',
                        message: {
                            content: [{ type: 'tool_use', id: 'tu_2', name: 'bash', input: {} }],
                        },
                    },
                    {
                        type: 'user',
                        message: {
                            content: [{ type: 'tool_result', tool_use_id: 'tu_2', is_error: true }],
                        },
                    },
                    { type: 'result', subtype: 'success' },
                ]),
            ),
        )
        const result = frames.find((frame) => frame.type === 'tool_result')
        expect(result).toEqual({ type: 'tool_result', id: 'tu_2', name: 'bash', ok: false })
    })

    test('an abnormal result subtype (e.g. max turns) maps to done: error', async () => {
        const { done } = await assertAgentFrameConformance(
            framesFromMessages(
                scripted([textDelta('partial'), { type: 'result', subtype: 'error_max_turns' }]),
            ),
        )
        expect(done.stop).toBe('error')
    })
})
