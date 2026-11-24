// A MESSAGES API THAT CITES: every request is answered with a run of plain words, then a cited run —
// a page of the statement it was handed — and a usage that read most of the prompt from the cache.
// `GET /last` answers the body of the request before it, as it arrived.
//
// Spawned rather than served in the test's process: the DOM preload replaces `Response`.

import { CITATION } from './CITATION.ts'

let last: unknown

const EVENTS = [
    {
        type: 'message_start',
        message: {
            usage: {
                input_tokens: 4,
                output_tokens: 1,
                cache_creation_input_tokens: 2,
                cache_read_input_tokens: 7,
            },
        },
    },
    {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
    },
    {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Your balance ' },
    },
    { type: 'content_block_stop', index: 0 },
    {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'text', text: '', citations: [] },
    },
    {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'citations_delta', citation: CITATION },
    },
    {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'is 4217' },
    },
    {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: '.' },
    },
    { type: 'content_block_stop', index: 1 },
    {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 6 },
    },
    { type: 'message_stop' },
]

const server = Bun.serve({
    port: 0,
    async fetch(request) {
        if (request.method === 'GET') return Response.json(last ?? null)
        last = await request.json()
        let body = ''
        for (const event of EVENTS)
            body += `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
        return new Response(body, {
            headers: { 'content-type': 'text/event-stream' },
        })
    },
})

console.log(server.url.href)

export {}
