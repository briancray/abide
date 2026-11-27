import type { AssistantContent, AssistantEvent } from '@abide/abide'
import type { ProviderEvent, Toolbox } from '@abide/abide/server'

/**
 * One run of a recorded model, as the Messages API streams it: its words and its tool calls in
 * order, each call's input written as JSON, ending for `stop`.
 */
export function recordedRun(
    content: Extract<AssistantContent, { type: 'text' | 'tool_use' }>[],
    stop: 'end_turn' | 'tool_use',
): AssistantEvent[] {
    const events: AssistantEvent[] = [
        {
            type: 'message_start',
            message: {
                id: 'msg_recorded',
                type: 'message',
                role: 'assistant',
                model: 'recorded',
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 0, output_tokens: 0 },
            },
        },
    ]
    for (const [index, block] of content.entries()) {
        if (block.type === 'text') {
            events.push(
                {
                    type: 'content_block_start',
                    index,
                    content_block: { type: 'text', text: '' },
                },
                {
                    type: 'content_block_delta',
                    index,
                    delta: { type: 'text_delta', text: block.text },
                },
            )
        } else {
            events.push(
                {
                    type: 'content_block_start',
                    index,
                    content_block: { ...block, input: {} },
                },
                {
                    type: 'content_block_delta',
                    index,
                    delta: {
                        type: 'input_json_delta',
                        partial_json: JSON.stringify(block.input),
                    },
                },
            )
        }
        events.push({ type: 'content_block_stop', index })
    }
    events.push(
        {
            type: 'message_delta',
            delta: { stop_reason: stop, stop_sequence: null },
            usage: { output_tokens: 0 },
        },
        { type: 'message_stop' },
    )
    return events
}

/**
 * A recorded model calling the app's tool `name` with `input`, for real: the run asking for it, then
 * its result, the first piece of its answer as words.
 */
export async function* recordedCall(
    tools: Toolbox,
    name: string,
    input: Record<string, unknown>,
): AsyncGenerator<ProviderEvent> {
    yield* recordedRun(
        [{ type: 'tool_use', id: 'toolu_1', name, input }],
        'tool_use',
    )
    const { content, isError } = await tools.call(name, input)
    const [words] = content
    yield {
        type: 'tool_result',
        tool_use_id: 'toolu_1',
        content: [
            { type: 'text', text: words?.type === 'text' ? words.text : '' },
        ],
        is_error: isError,
    }
}
