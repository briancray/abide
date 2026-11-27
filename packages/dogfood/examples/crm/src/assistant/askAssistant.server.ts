import {
    assistant,
    type AssistantMessage,
    type Provider,
    rpc,
} from '@abide/abide/server'

import { recordedCall, recordedRun } from '#src/lib/recordedRun.ts'

// A recorded model: its lines are fixed, and the tool call it makes is real.
const recorded: Provider = {
    async *run(_messages, tools) {
        const tool = tools.list.find((each) =>
            each.name.endsWith('assistant_searchContacts'),
        )
        const name = tool?.name ?? ''
        const input = { name: 'Ada' }
        yield* recordedCall(tools, name, input)
        yield* recordedRun(
            [{ type: 'text', text: 'Ada Lovelace is at Analytical Engines.' }],
            'end_turn',
        )
    },
}

export default rpc(
    async function* ({ messages }: { messages: AssistantMessage[] }) {
        yield* assistant(messages, recorded, { tools: true })
    },
    {
        methods: ['POST'],
        description: 'Asks the CRM assistant.',
        clients: { mcp: false },
    },
)
