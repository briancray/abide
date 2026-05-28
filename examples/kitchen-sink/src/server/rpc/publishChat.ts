import { error } from 'belte/server/error'
import { json } from 'belte/server/json'
import { POST } from 'belte/server/POST'
import { z } from 'zod'
import { type ChatMessage, chat } from '$server/sockets/chat.ts'

const schema = z.object({ from: z.string(), text: z.string() })

/*
POST handler that records a chat message and publishes it to the
`chat` socket. Anyone subscribed — server-side `for await (const m of
chat)` or browser-side `subscribe(chat)` — receives the message.
Validation runs ahead of the handler via the attached Standard
Schema; trimming + non-empty checks stay here because they're domain
rules, not shape rules. Schema also auto-exposes the rpc to MCP +
CLI (see /mcp and /cli).
*/
export const publishChat = POST(
    ({ from, text }) => {
        const trimmedFrom = from.trim()
        const trimmedText = text.trim()
        if (!trimmedFrom || !trimmedText) {
            return error(400, 'from and text are required')
        }
        const message: ChatMessage = {
            id: crypto.randomUUID(),
            from: trimmedFrom,
            text: trimmedText,
            at: Date.now(),
        }
        chat.publish(message)
        return json(message)
    },
    { schema },
)
