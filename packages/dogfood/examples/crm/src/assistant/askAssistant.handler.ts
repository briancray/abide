import {
    assistant,
    type AssistantMessage,
    POST,
    type Provider,
} from '@abide/abide/server'

import { recordedRun } from '#src/lib/recordedRun.ts'

// A recorded model: its lines are fixed, and the tool call it makes is real.
const recorded: Provider = {
    async *run(_messages, tools) {
        const tool = tools.list.find((each) =>
            each.name.endsWith('assistant_searchContacts'),
        )
        const name = tool?.name ?? ''
        const input = { name: 'Ada' }
        yield* recordedRun(
            [{ type: 'tool_use', id: 'toolu_1', name, input }],
            'tool_use',
        )
        const { content, isError } = await tools.call(name, input)
        // A search answers words, so its one piece is text.
        const [words] = content
        yield {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: [
                {
                    type: 'text',
                    text: words?.type === 'text' ? words.text : '',
                },
            ],
            is_error: isError,
        }
        yield* recordedRun(
            [{ type: 'text', text: 'Ada Lovelace is at Analytical Engines.' }],
            'end_turn',
        )
    },
}

export default POST(
    async function* ({ messages }: { messages: AssistantMessage[] }) {
        yield* assistant(messages, recorded, { mcp: true })
    },
    { description: 'Asks the CRM assistant.', clients: { mcp: false } },
)
