// THE MESSAGES API CLIENT, BY HAND: the request body, the headers, and the
// event stream's framing, each written against Anthropic's documentation
// rather than read from anything the code can check.
const API_VERSION = '2023-06-01'

async function* textOf(body: ReadableStream<Uint8Array>) {
    const reader = body.pipeThrough(new TextDecoderStream()).getReader()
    let held = ''
    for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        held += value
        const lines = held.split('\n')
        held = lines.pop() ?? ''
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const event = JSON.parse(line.slice('data: '.length))
            if (event.type === 'error') throw new Error(event.error.message)
            if (event.delta?.type === 'text_delta') yield event.delta.text
        }
    }
}

Bun.serve({
    routes: {
        '/api/ask': {
            POST: async (request) => {
                const { messages } = (await request.json()) as {
                    messages: unknown[]
                }
                const answered = await fetch(
                    new URL('/v1/messages', request.url),
                    {
                        method: 'POST',
                        headers: {
                            'content-type': 'application/json',
                            'x-api-key': 'the stand-in reads none',
                            'anthropic-version': API_VERSION,
                        },
                        body: JSON.stringify({
                            model: 'claude-opus-5',
                            max_tokens: 1024,
                            system: 'Answer questions about invoices.',
                            thinking: { type: 'adaptive' },
                            stream: true,
                            messages,
                        }),
                    },
                )
                if (!answered.ok || answered.body === null)
                    return new Response(await answered.text(), { status: 502 })
                let text = ''
                for await (const piece of textOf(answered.body)) text += piece
                return new Response(text)
            },
        },
        // The same stand-in the card points `baseURL` at.
        '/v1/messages': {
            POST: async (request) => {
                const asked = await request.json()
                const events = [
                    {
                        type: 'content_block_delta',
                        index: 0,
                        delta: {
                            type: 'text_delta',
                            text: JSON.stringify(asked, null, 2),
                        },
                    },
                    {
                        type: 'message_delta',
                        delta: { stop_reason: 'end_turn' },
                    },
                ]
                let body = ''
                for (const event of events)
                    body += `data: ${JSON.stringify(event)}\n\n`
                return new Response(body, {
                    headers: { 'content-type': 'text/event-stream' },
                })
            },
        },
    },
})
