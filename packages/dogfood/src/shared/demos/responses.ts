// What a route ANSWERS with.
//
// Server-side because a `Response` is: the browser lane reads one, it never builds one. Six helpers
// over `new Response(…)`, and each earns its place by getting one thing right that the hand-written
// form gets wrong often enough to be worth a name — the content type on `json`, the HOLD on a
// streamed `page` body, the semantic difference between 301 and 302, and one framing decision for
// `jsonl` and `sse` that the handler above them never sees.
//
// A handler returning a plain value needs none of this: the transport encodes it, and that is the
// common case. These are for a route building its own answer.
//
// The claims below are about the RESPONSE rather than about a round trip — status, headers, the body
// as text — because a helper's whole job is what it puts on the object. A test that fetched one
// would be testing the server that carried it.

import { error, HttpError, json, jsonl, page, redirect, sse } from 'abide/server'
import { suite } from 'harness'
import { META } from './SUITES.ts'

/** Three records, as a source that has not finished when the response is built. */
async function* items(): AsyncGenerator<{ id: number }> {
    for (let id = 1; id <= 3; id++) {
        await Promise.resolve()
        yield { id }
    }
}

export default suite({
    ...META.responses,
    cases: [
        {
            title: 'json and page set the type, so no handler writes one',
            note: 'The header is the whole of what these two add over `new Response(body)` — and it is the one an app forgets, because a body that looks right in a terminal looks right without it. Asserted as a PAIR: the two differ only in the type they set, so checking one and trusting the other is checking nothing.',
            async run({ is }) {
                const asJson = json({ items: ['alpha', 'beta'] })
                is('json says so', asJson.headers.get('content-type')?.includes('application/json'), true)
                is('and serialised the value', await asJson.text(), '{"items":["alpha","beta"]}')

                const asPage = page('<h1>alpha</h1>')
                is('page says HTML', asPage.headers.get('content-type')?.includes('text/html'), true)
                is('and passed the body through untouched', await asPage.text(), '<h1>alpha</h1>')

                is('an init still wins where it is allowed to', json({}, { status: 201 }).status, 201)
            },
        },

        {
            title: 'redirect is a location and nothing else',
            note: 'A body on a redirect is a body nobody reads, so there is none. The status is an ARGUMENT rather than a default nobody revisits, because 301 is cached by every intermediary that sees it and 302 is not — the difference is permanent, and defaulting to the permanent one is how a wrong URL becomes unfixable.',
            async run({ is }) {
                const moved = redirect('/items/7')
                is('the location', moved.headers.get('location'), '/items/7')
                is('302 by default — the reversible one', moved.status, 302)
                is('and no body to read', await moved.text(), '')
                is('the permanent one is asked for', redirect('/items/7', 301).status, 301)
            },
        },

        {
            title: 'error THROWS, which is what lets it come from anywhere',
            note: 'A refusal four frames under a handler would otherwise have to be passed back up by every frame between — and each of those frames would need a shape to pass it in. Throwing is what makes the depth irrelevant. The carried status is the point: an `HttpError` is not a 500 that lost its meaning on the way out.',
            async run({ is }) {
                let caught: unknown
                try {
                    // Two frames down, so the claim is about the throw crossing them.
                    const refuse = (): never => error(400, 'an id starts at 1')
                    const handler = (): never => refuse()
                    handler()
                } catch (thrown) {
                    caught = thrown
                }
                is('an HttpError', caught instanceof HttpError, true)
                is('carrying the status', (caught as HttpError).status, 400)
                is('and the phrase given', (caught as HttpError).message, 'an id starts at 1')
                // The phrase is OPTIONAL, and the status has to still mean something without it.
                let bare: unknown
                try {
                    error(404)
                } catch (thrown) {
                    bare = thrown
                }
                is('a status alone still reads', (bare as HttpError).status, 404)
                is('…with the phrase filled in', (bare as HttpError).message.length > 0, true)
            },
        },

        {
            title: 'jsonl and sse are two framings of ONE source',
            note: 'The handler above them is an ordinary async generator and does not know which it got — which is the claim, and it cannot be made by testing either alone. So both arms consume the SAME generator function and the assertion is that the records survive the framing, not that a particular string came out.',
            async run({ is }) {
                const lines = await jsonl(items()).text()
                is('one JSON document per line', lines.trim().split('\n'), [
                    '{"id":1}',
                    '{"id":2}',
                    '{"id":3}',
                ])

                const events = await sse(items()).text()
                const carried: unknown[] = []
                for (const line of events.split('\n')) {
                    if (line.startsWith('data: ')) carried.push(JSON.parse(line.slice(6)))
                }
                is('the same three records, framed as events', carried, [{ id: 1 }, { id: 2 }, { id: 3 }])
                is(
                    'and an EventSource is told so',
                    sse(items()).headers.get('content-type'),
                    'text/event-stream',
                )
            },
        },
    ],
})
