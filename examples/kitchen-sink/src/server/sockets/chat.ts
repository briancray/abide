import { socket } from '@belte/belte/server/socket'
import { z } from 'zod'

export type ChatMessage = { id: string; from: string; text: string; at: number }

const schema = z.object({
    id: z.string(),
    from: z.string(),
    text: z.string(),
    at: z.number(),
})

/*
A topic-style broadcast: anyone with the import can publish or read.
`tail: 100` opts the topic into retention — the socket keeps its last
100 messages so readers that weren't there can seed: `chat.tail(n)`
iteration, the reactive `tail()` consumer, and the MCP/CLI read faces.
Bare iteration is the live stream only. `ttl` bounds the retention's
age: retained frames older than an hour are dropped (lazy eviction, no
timers), so a quiet room doesn't replay stale chatter. `clientPublish`
is left off (default false) so browsers can't publish directly —
publish flows through publishChat which validates input and runs
server-side. The attached schema validates publish payloads
synchronously and auto-exposes the socket to MCP and the CLI as a
`chat-tail` read tool/command (the retained tail); a `chat-publish`
would also appear if `clientPublish` were on.
*/
export const chat = socket<ChatMessage>({ tail: 100, ttl: 3_600_000, schema })
