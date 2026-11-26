import {
    assistant,
    type AssistantMessage,
    provider,
    request,
    rpc,
    server,
} from '@abide/abide/server'

import standIn from './v1/messages.server.ts'

export default rpc(
    async function* ({ messages }: { messages: AssistantMessage[] }) {
        // This app's stand-in for https://api.anthropic.com, at the socket this app listens on —
        // never the origin a request names, which its `Host` header makes anyone's (42.9). Served
        // through `app.fetch`, nothing is bound, and the request's own is all there is.
        let origin: string
        try {
            origin = server().url.origin
        } catch {
            origin = new URL(request().url).origin
        }
        const standInAt = new URL(standIn.url({}), origin)
        yield* assistant(
            messages,
            provider.claudeApi({
                apiKey: 'the stand-in reads none',
                baseURL: standInAt.href.replace('/v1/messages', ''),
                model: 'claude-opus-5',
                max_tokens: 1024,
                system: 'Answer questions about contacts.',
            }),
        )
    },
    {
        methods: ['POST'],
        description: 'Asks Claude, on the API.',
        clients: { mcp: false },
    },
)
