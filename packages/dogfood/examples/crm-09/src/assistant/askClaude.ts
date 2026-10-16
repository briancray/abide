import {
    type AssistantMessage,
    assistant,
    claudeApi,
    POST,
    request,
} from '@abide/abide/server'
import standIn from './v1/messages.ts'

export default POST(
    async function* ({ messages }: { messages: AssistantMessage[] }) {
        // This app's stand-in for https://api.anthropic.com.
        const standInAt = new URL(standIn.url({}), request().url)
        yield* assistant(
            messages,
            claudeApi({
                apiKey: 'the stand-in reads none',
                baseURL: standInAt.href.replace('/v1/messages', ''),
                model: 'claude-opus-5',
                max_tokens: 1024,
                system: 'Answer questions about contacts.',
            }),
        )
    },
    { description: 'Asks Claude, on the API.', clients: { mcp: false } },
)
