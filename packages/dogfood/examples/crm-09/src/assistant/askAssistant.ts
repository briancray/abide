import {
    type AssistantMessage,
    assistant,
    POST,
    type Provider,
} from '@abide/abide/server'

// A recorded model: its lines are fixed, and the tool call it makes is real.
const recorded: Provider = {
    async *run(_messages, tools) {
        const tool = tools.list.find((each) =>
            each.name.endsWith('assistant_searchContacts'),
        )
        const name = tool?.name ?? ''
        const input = { name: 'Ada' }
        yield { type: 'tool', id: 'toolu_1', name }
        yield { type: 'input', id: 'toolu_1', input }
        const answered = await tools.call(name, input)
        yield { type: 'result', id: 'toolu_1', ...answered }
        yield { type: 'text', text: 'Ada Lovelace is at Analytical Engines.' }
        yield { type: 'done', stop: 'end_turn', usage: { input: 0, output: 0 } }
    },
}

export default POST(
    async function* ({ messages }: { messages: AssistantMessage[] }) {
        yield* assistant(messages, recorded, { mcp: true })
    },
    { description: 'Asks the CRM assistant.', clients: { mcp: false } },
)
