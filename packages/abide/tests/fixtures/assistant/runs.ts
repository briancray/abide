// THE RUNS THE FAKE MODELS PLAY, as the Messages API streams each, event for event: `fakeMessagesApi`
// sends them as server-sent events and the fake Claude Code as its `stream_event` lines, so one
// conversation played by either provider is one sequence of events.

/** A run's `message_start`, with the usage it opened on. */
function started(input: number): unknown {
    return {
        type: 'message_start',
        message: {
            id: 'msg_fake',
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5-5',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: input, output_tokens: 1 },
        },
    }
}

/** A run's end: why it stopped, and the output it wrote. */
function ended(stop: string, output: number): unknown[] {
    return [
        {
            type: 'message_delta',
            delta: { stop_reason: stop, stop_sequence: null },
            usage: { output_tokens: output },
        },
        { type: 'message_stop' },
    ]
}

/** A text block at `index` saying `text`. */
function words(index: number, text: string): unknown[] {
    return [
        {
            type: 'content_block_start',
            index,
            content_block: { type: 'text', text: '' },
        },
        {
            type: 'content_block_delta',
            index,
            delta: { type: 'text_delta', text },
        },
        { type: 'content_block_stop', index },
    ]
}

/** A run that says `text` and ends, having read `input` tokens and written `output`. */
export function said(text: string, input: number, output: number): unknown[] {
    return [started(input), ...words(0, text), ...ended('end_turn', output)]
}

/**
 * A run that thinks — its thinking block signed, as the API refuses a tool loop without it echoed —
 * says `checking`, perhaps a word more, and calls `tool` with no input.
 */
export function calling(tool: string, more?: string): unknown[] {
    const extra = more === undefined ? [] : words(2, more)
    const at = more === undefined ? 2 : 3
    return [
        started(1),
        {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'thinking', thinking: '', signature: '' },
        },
        {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'signature_delta', signature: 'SIGNED' },
        },
        { type: 'content_block_stop', index: 0 },
        ...words(1, 'checking'),
        ...extra,
        {
            type: 'content_block_start',
            index: at,
            content_block: {
                type: 'tool_use',
                id: 'toolu_1',
                name: tool,
                input: {},
            },
        },
        { type: 'content_block_stop', index: at },
        ...ended('tool_use', 2),
    ]
}

/** A run that starts calling `post_invoices_whoami` and is still writing its input. */
export function writing(tool: string): unknown[] {
    return [
        started(1),
        {
            type: 'content_block_start',
            index: 0,
            content_block: {
                type: 'tool_use',
                id: 'toolu_1',
                name: tool,
                input: {},
            },
        },
        {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{' },
        },
    ]
}
