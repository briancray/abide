import {
    type AssistantMessage,
    assistant,
    POST,
    type Provider,
} from 'abide/server'

const TOOL = 'assistantToolsInvoices_invoiceStatus'

// The model is a recording; the tool call it asks for is made for real.
const recorded: Provider = {
    async *run(_messages, tools) {
        const input = { id: 'INV-4021' }
        yield { type: 'tool', id: 'toolu_1', name: TOOL, input }
        const answered = await tools.call(TOOL, input)
        yield { type: 'result', id: 'toolu_1', ...answered }
        yield { type: 'text', text: 'Yes, INV-4021 is paid.' }
        yield { type: 'done', stop: 'end_turn', usage: { input: 0, output: 0 } }
    },
}

export const ask = POST(
    async function* ({ messages }: { messages: AssistantMessage[] }) {
        yield* assistant(messages, recorded, { mcp: true })
    },
    { clients: { mcp: false } },
)
