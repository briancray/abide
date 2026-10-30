import { POST, sse } from '@abide/abide/server'

// A stand-in for the Messages API, streaming back the body it was sent.
export default POST(
    (asked: Record<string, unknown>) =>
        sse([
            { type: 'message_start', message: { usage: { input_tokens: 0 } } },
            {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
            },
            {
                type: 'content_block_delta',
                index: 0,
                delta: {
                    type: 'text_delta',
                    text: JSON.stringify(asked, null, 2),
                },
            },
            { type: 'content_block_stop', index: 0 },
            {
                type: 'message_delta',
                delta: { stop_reason: 'end_turn' },
                usage: { output_tokens: 0 },
            },
        ]),
    { clients: { ui: false, mcp: false, cli: false, openapi: false } },
)
