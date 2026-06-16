import { socket } from '@abide/abide/server/socket'
import { z } from 'zod'

const schema = z.object({
    id: z.string(),
    from: z.string(),
    text: z.string(),
    at: z.number(),
})

/*
A topic-style broadcast: anyone with the import can publish or read.
`tail: 100` opts the topic into retention — the socket keeps its last
100 frames so late joiners seed via `chat.tail(count?)` iteration, the
reactive `tail()` consumer, and the MCP/CLI read faces. Bare iteration
is the live stream only. `ttl` bounds the retention's age: retained
frames older than an hour are evicted lazily (no timers), so a quiet
room doesn't replay stale chatter. `clientPublish` is left off (default
false) so browsers can't publish directly — publish flows through
publishChat, which validates input and runs server-side. The schema
validates publishes synchronously, infers the frame type, and flips the
mcp/cli surfaces on: a `chat-tail` read tool/command appears (a
`chat-publish` would too if `clientPublish` were on).
*/
export const chat = socket({ schema, tail: 100, ttl: 3_600_000 })

export type ChatMessage = z.infer<typeof schema>
