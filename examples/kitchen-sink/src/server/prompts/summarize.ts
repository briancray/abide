import { prompt } from 'belte/server/prompt'
import { z } from 'zod'

const schema = z.object({
    topic: z.string(),
    tone: z.string().optional(),
})

/*
An MCP prompt. The schema both validates the incoming arguments and feeds
the argument list MCP advertises in `prompts/list` (`topic` required,
`tone` optional). `render(args)` returns the messages handed back from
`prompts/get` — a bare string is sugar for one `user` message. Prompts are
MCP-only; there's no browser or CLI counterpart.
*/
export const summarize = prompt({
    description: 'Draft a request to summarize a topic.',
    schema,
    render: ({ topic, tone }) =>
        `Write a concise summary of ${topic}${tone ? ` in a ${tone} tone` : ''}.`,
})
