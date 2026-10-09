import {
    type AssistantMessage,
    assistant,
    claudeCode,
    GET,
    POST,
} from 'abide/server'

export const bridge = GET(() => claudeCode.bridge(), {
    timeout: Infinity,
    clients: { mcp: false },
})

export const ask = POST(
    async function* ({ messages }: { messages: AssistantMessage[] }) {
        yield* assistant(
            messages,
            claudeCode({ systemPrompt: 'Answer in one sentence.' }),
        )
    },
    { clients: { mcp: false } },
)
