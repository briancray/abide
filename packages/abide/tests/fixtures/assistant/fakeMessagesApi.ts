// A MESSAGES API THAT PLAYS ONE CONVERSATION: a first run that thinks and asks for
// `post_invoices_whoami`, and a second that answers with what the tool said. The second run is refused
// 400 unless the first run's thinking block came back with its signature, as the real API refuses a
// tool loop without it. Each run is one of `runs.ts`, which the fake Claude Code plays too.
//
// A last turn holding an image is answered at once with that turn's content as it came, blocks and all.
//
// A prompt holding `show me` asks for `get_pictures_drawn` instead. The second run answers with the
// result's content as it came back: its text blocks' words, and any other block as its JSON.
//
// A prompt holding `writing` starts the tool call and never finishes it: the stream stays open after the
// call's first input, the way a model still writing the call's input holds it.
//
// Spawned rather than served in the test's process: the DOM preload replaces `Response`.

import { calling, said, writing } from './runs.ts'

/** `events` as an event stream, which stays open after them where `held`. */
function sse(events: unknown[], held = false): Response {
    let body = ''
    for (const event of events)
        body += `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`
    return new Response(
        held
            ? new ReadableStream({
                  start(controller) {
                      controller.enqueue(new TextEncoder().encode(body))
                  },
              })
            : body,
        { headers: { 'content-type': 'text/event-stream' } },
    )
}

type Turn = { role: string; content: unknown }

const server = Bun.serve({
    port: 0,
    async fetch(request) {
        const body = (await request.json()) as { messages: Turn[] }
        const last = body.messages.at(-1) as Turn
        const blocks = last.content as { type: string; text?: string }[]
        const words = blocks.map((block) => block.text ?? '').join('')
        if (blocks.some((block) => block.type === 'image'))
            return sse(said(`saw ${JSON.stringify(last.content)}`, 1, 1))
        if (words === 'writing')
            return sse(writing('post_invoices_whoami'), true)
        if (!blocks.some((block) => block.type === 'tool_result'))
            return sse(
                calling(
                    words === 'show me'
                        ? 'get_pictures_drawn'
                        : 'post_invoices_whoami',
                ),
            )
        const asked = body.messages.at(-2) as {
            content: { type: string; signature?: string }[]
        }
        if (asked.content[0]?.signature !== 'SIGNED')
            return new Response('thinking block not echoed', { status: 400 })
        const result = (
            last.content as { type: string; content: unknown }[]
        )[0] as { content: unknown }
        return sse(
            said(
                `saw ${(result.content as { type: string; text?: string }[]).map((block) => (block.type === 'text' ? block.text : JSON.stringify(block))).join('')}`,
                2,
                3,
            ),
        )
    },
})

console.log(server.url.href)

export {}
