// A MESSAGES API THAT PLAYS ONE CONVERSATION: a first turn that thinks and asks for `invoices_whoami`,
// and a second that answers with what the tool said. The second turn is refused 400 unless the first
// turn's thinking block came back with its signature, as the real API refuses a tool loop without it.
//
// Spawned rather than served in the test's process: the DOM preload replaces `Response`.

function sse(events: unknown[]): Response {
    let body = ''
    for (const event of events)
        body += `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`
    return new Response(body, {
        headers: { 'content-type': 'text/event-stream' },
    })
}

type Turn = { role: string; content: unknown }

const server = Bun.serve({
    port: 0,
    async fetch(request) {
        const body = (await request.json()) as { messages: Turn[] }
        const last = body.messages.at(-1) as Turn
        if (typeof last.content === 'string')
            return sse([
                {
                    type: 'message_start',
                    message: { usage: { input_tokens: 1, output_tokens: 1 } },
                },
                {
                    type: 'content_block_start',
                    index: 0,
                    content_block: {
                        type: 'thinking',
                        thinking: '',
                        signature: '',
                    },
                },
                {
                    type: 'content_block_delta',
                    index: 0,
                    delta: { type: 'signature_delta', signature: 'SIGNED' },
                },
                { type: 'content_block_stop', index: 0 },
                {
                    type: 'content_block_start',
                    index: 1,
                    content_block: { type: 'text', text: '' },
                },
                {
                    type: 'content_block_delta',
                    index: 1,
                    delta: { type: 'text_delta', text: 'checking' },
                },
                { type: 'content_block_stop', index: 1 },
                {
                    type: 'content_block_start',
                    index: 2,
                    content_block: {
                        type: 'tool_use',
                        id: 'toolu_1',
                        name: 'invoices_whoami',
                        input: {},
                    },
                },
                { type: 'content_block_stop', index: 2 },
                {
                    type: 'message_delta',
                    delta: { stop_reason: 'tool_use' },
                    usage: { output_tokens: 2 },
                },
                { type: 'message_stop' },
            ])
        const asked = body.messages.at(-2) as {
            content: { type: string; signature?: string }[]
        }
        if (asked.content[0]?.signature !== 'SIGNED')
            return new Response('thinking block not echoed', { status: 400 })
        const result = (
            last.content as { type: string; content: string }[]
        )[0] as { content: string }
        return sse([
            {
                type: 'message_start',
                message: { usage: { input_tokens: 2, output_tokens: 1 } },
            },
            {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
            },
            {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: `saw ${result.content}` },
            },
            { type: 'content_block_stop', index: 0 },
            {
                type: 'message_delta',
                delta: { stop_reason: 'end_turn' },
                usage: { output_tokens: 3 },
            },
            { type: 'message_stop' },
        ])
    },
})

console.log(server.url.href)

export {}
