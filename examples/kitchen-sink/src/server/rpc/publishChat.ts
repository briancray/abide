import { error } from '@abide/abide/server/error'
import { json } from '@abide/abide/server/json'
import { POST } from '@abide/abide/server/POST'
import { z } from 'zod'
import { type ChatMessage, chat } from '$server/sockets/chat.ts'
import { recordChat } from '../../chatState.ts'

const inputSchema = z.object({ from: z.string(), text: z.string() })

/*
POST handler that records a chat message and publishes it to the
`chat` socket. Every live reader — server-side `for await (const m of
chat)` or browser-side `tail(chat)` — receives the message.
Validation runs ahead of the handler via the attached `inputSchema`;
trimming + non-empty checks stay here because they're domain rules, not
shape rules. The inputSchema auto-exposes the rpc to the CLI (see /cli);
as a mutating POST it stays off MCP unless it opts in via `clients.mcp`.
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
        recordChat(message)
        chat.publish(message)
        return json(message)
    },
    { inputSchema },
)
