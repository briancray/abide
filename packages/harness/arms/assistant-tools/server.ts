const PAID = new Set(['INV-4021'])

// THE TOOL TABLE, WRITTEN OUT. The name, the description and the input
// schema are a second copy of the handler, and the dispatch below is a
// third — none of them is checked against the function it calls.
const TOOLS = [
    {
        name: 'invoiceStatus',
        description: 'Whether an invoice has been paid, by its number.',
        input_schema: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
        },
    },
]

function callTool(name: string, input: { id: string }) {
    if (name !== 'invoiceStatus')
        return { text: `No tool named ${name}.`, failed: true }
    const answer = { id: input.id, paid: PAID.has(input.id) }
    return { text: JSON.stringify(answer), failed: false }
}

// The same recording the card's provider replays.
async function* recorded(tools: typeof TOOLS) {
    const name = tools[0]?.name ?? ''
    const input = { id: 'INV-4021' }
    yield { type: 'tool', id: 'toolu_1', name, input }
    yield { type: 'result', id: 'toolu_1', ...callTool(name, input) }
    yield { type: 'text', text: 'Yes, INV-4021 is paid.' }
    yield { type: 'done', stop: 'end_turn', usage: { input: 0, output: 0 } }
}

Bun.serve({
    routes: {
        '/api/ask': {
            POST: async (request) => {
                const { messages } = (await request.json()) as {
                    messages: { role: string }[]
                }
                if (messages.at(-1)?.role !== 'user')
                    return new Response('end on a user turn', { status: 400 })
                const lines = new ReadableStream<string>({
                    async start(controller) {
                        for await (const event of recorded(TOOLS))
                            controller.enqueue(`${JSON.stringify(event)}\n`)
                        controller.close()
                    },
                })
                return new Response(
                    lines.pipeThrough(new TextEncoderStream()),
                    {
                        headers: { 'content-type': 'application/jsonl' },
                    },
                )
            },
        },
    },
})
