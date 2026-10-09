import {
    type AssistantMessage,
    assistant,
    claudeApi,
    POST,
    request,
} from 'abide/server'
import { messages as standIn } from '#server/rpc/claudeApiModel/v1'

export const ask = POST(
    async function* ({ messages }: { messages: AssistantMessage[] }) {
        // This site's stand-in for https://api.anthropic.com.
        const standInAt = new URL(standIn.url({}), request().url)
        yield* assistant(
            messages,
            claudeApi({
                apiKey: 'the stand-in reads none',
                baseURL: standInAt.href.replace('/v1/messages', ''),
                model: 'claude-opus-5',
                max_tokens: 1024,
                system: 'Answer questions about invoices.',
                thinking: { type: 'adaptive' },
            }),
        )
    },
    { clients: { mcp: false } },
)
