import {
    assistant,
    type AssistantMessage,
    provider,
    rpc,
} from '@abide/abide/server'

export const askClaudeCode = rpc(
    async function* ({ messages }: { messages: AssistantMessage[] }) {
        yield* assistant(
            messages,
            provider.claudeCode({ systemPrompt: 'Answer in one sentence.' }),
            { tools: true },
        )
    },
    {
        methods: ['POST'],
        description: "Asks the visitor's Claude Code.",
        clients: { mcp: false },
    },
)
