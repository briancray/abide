import { socket } from '@briancray/belte/server/socket'
import { z } from 'zod'

export type ChatMessage = { id: string; from: string; text: string; at: number }

const schema = z.object({
    id: z.string(),
    from: z.string(),
    text: z.string(),
    at: z.number(),
})

/*
A topic-style broadcast: anyone with the import can publish or
subscribe. `history: 100` retains the last 100 messages and replays
them to new subscribers. `clientPublish` is left off (default false)
so browsers can't publish directly — publish flows through publishChat
which validates input and runs server-side. The attached schema
validates publish payloads synchronously. Sockets aren't exposed to
MCP — only schema-bearing rpcs (tools) and prompts are (see /mcp).
*/
export const chat = socket<ChatMessage>({ history: 100, schema })
