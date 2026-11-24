// A MESSAGES API THAT CITES: every request is answered with `CITED_EVENTS` — a run of plain words, then
// a cited run, and a usage that read most of the prompt from the cache. `GET /last` answers the body of
// the request before it, as it arrived.
//
// Spawned rather than served in the test's process: the DOM preload replaces `Response`.

import { CITED_EVENTS } from './CITED_EVENTS.ts'

let last: unknown

const server = Bun.serve({
    port: 0,
    async fetch(request) {
        if (request.method === 'GET') return Response.json(last ?? null)
        last = await request.json()
        let body = ''
        for (const event of CITED_EVENTS)
            body += `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
        return new Response(body, {
            headers: { 'content-type': 'text/event-stream' },
        })
    },
})

console.log(server.url.href)

export {}
