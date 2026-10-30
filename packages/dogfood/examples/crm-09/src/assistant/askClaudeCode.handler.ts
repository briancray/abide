import {
    type AssistantMessage,
    assistant,
    claudeCode,
    POST,
} from '@abide/abide/server'

export default POST(
    async function* ({ messages }: { messages: AssistantMessage[] }) {
        yield* assistant(
            messages,
            claudeCode({ systemPrompt: 'Answer in one sentence.' }),
            { mcp: true },
        )
    },
    { description: "Asks the visitor's Claude Code.", clients: { mcp: false } },
)
