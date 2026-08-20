// The caller's scope: what a request carries, asked for from anywhere inside it.
//
// Five ambients over one store. Ambients rather than parameters for the reason `route()` is one — a
// helper four frames under a route reads a cookie without every frame between it declaring one — and
// the same property is what makes a module-level `memo` per-caller: the scope IS the request, so a
// cache keyed inside one cannot serve the last caller's data to this one.
//
// `serve()` is what installs it, and it is on `abide/server/internal` because `abide start` is what
// calls it. Reached here directly, which is the honest way to test a scope: a case is not a process.
//
// Every case here is a `server` face rather than a `run`, and the whole capability is: a request scope
// is an `AsyncLocalStorage`, which a browser does not have. Written as `run`, all four threw on
// `/tests/request` and painted red there — a page saying "broken" where it meant "cannot ask" — while
// `bun test` stayed green, because `bun test` is the substrate that has one.
//
// Three of the five hand back a `Map` — `bag()`, `cookies()` and `trace().state` — and that is a
// decision rather than a coincidence. A third spelling for "a store that lives as long as this
// request" is a third thing to remember.

import { bag, cookies, nonce, page, request, trace } from 'abide/server'
import { isServing, serve } from 'abide/server/internal'
import { suite } from 'harness'
import { META } from './SUITES.ts'

const ASKED = new Request('https://example.test/items?q=ada', {
    headers: { cookie: 'theme=dark; seen=2', 'user-agent': 'the dogfood app' },
})

export default suite({
    ...META.request,
    cases: [
        {
            title: 'inside a scope every ambient answers; outside one they refuse',
            note: 'The refusal is the load-bearing half. An ambient that returned a plausible empty value outside a request would let a handler read a cookie that was never sent and take the branch for a caller who does not exist — so the failure is loud, and it names the call that would have fixed it.',
            async server({ is }) {
                is('nothing is being served out here', isServing(), false)
                let refused = false
                try {
                    request()
                } catch {
                    refused = true
                }
                is('…so asking is an error, not an empty answer', refused, true)

                serve(ASKED, () => {
                    is('inside, a scope exists', isServing(), true)
                    is('and the Request is the one being answered', request().url.endsWith('?q=ada'), true)
                })
                is('and it is gone again afterwards', isServing(), false)
            },
        },

        {
            title: 'cookies parse once, and the same call twice is the same Map',
            note: 'Parsed on the FIRST ask rather than per request, so a route that never reads one pays nothing at all — which is a claim about work, not about the value, so it is asserted by IDENTITY. Two calls returning equal maps would pass with the header parsed twice.',
            async server({ is }) {
                serve(ASKED, () => {
                    const first = cookies()
                    is(
                        'the header, parsed',
                        [...first],
                        [
                            ['theme', 'dark'],
                            ['seen', '2'],
                        ],
                    )
                    is('and the second ask is the SAME map, not an equal one', cookies() === first, true)
                    first.set('theme', 'light')
                    is(
                        'so a write inside the request is seen by the next reader',
                        cookies().get('theme'),
                        'light',
                    )
                })
                // A second request is a second scope: the mutation above must not have escaped.
                serve(ASKED, () => {
                    is('and the next request parses the header again', cookies().get('theme'), 'dark')
                })
            },
        },

        {
            title: 'bag is yours, and two concurrent requests do not share it',
            note: 'The whole reason it is not a module-level variable. Asserted with the two scopes INTERLEAVED rather than one after the other — sequential scopes pass even when the store is a single global that is cleared between them, which is exactly the implementation this is guarding against.',
            async server({ is }) {
                let inner: unknown
                serve(new Request('https://example.test/a'), () => {
                    bag().set('who', 'a')
                    serve(new Request('https://example.test/b'), () => {
                        bag().set('who', 'b')
                        inner = bag().get('who')
                    })
                    is('the outer request still has its own', bag().get('who'), 'a')
                })
                is('and the inner one had its own all along', inner, 'b')
            },
        },

        {
            title: 'trace and nonce are minted once per request',
            note: 'Both are values two unrelated pieces of code have to AGREE on — a log line abide wrote and one the app wrote, a `<script>` and the header authorising it. So "the same within a request, different between them" is the entire contract, and neither half of it can be checked by one call.',
            async server({ is }) {
                let firstOperation = ''
                let firstNonce = ''
                serve(ASKED, () => {
                    firstOperation = trace()
                    firstNonce = nonce()
                    is('the operation id is stable inside the request', trace(), firstOperation)
                    is('…and so is the nonce', nonce(), firstNonce)
                    is('the hop has an id of its own', trace.span().length > 0, true)
                    is('and abide made no sampling decision', typeof trace.sampled(), 'boolean')
                })
                serve(ASKED, () => {
                    is('a second request is a second operation', trace() !== firstOperation, true)
                    is('…and a second nonce, or it would be guessable', nonce() !== firstNonce, true)
                })
            },
        },

        {
            title: 'the half of the policy an app never has to ask for',
            note: 'The rest of the baseline is opt-in because a directive naming where a resource may be LOADED from can blank an app abide cannot see, and a header that does that once is one nobody turns on again. These two name no source: `object-src` refuses plugin content, and `base-uri` refuses a `<base>` that would repoint every relative URL on the page. Neither can break a working app, so neither waits to be asked for — and `csp()` replaces the header wholesale, with a baseline that is a superset of this.',
            async run({ is }) {
                const policy = page('<p>a</p>').headers.get('content-security-policy')
                is(
                    'a page carries it with no middleware installed',
                    policy,
                    "object-src 'none'; base-uri 'self'",
                )
                // The counterexample that says it is a DEFAULT and not a rule: a route with its own
                // policy keeps it, the same way `cache-control` works one field up.
                const own = page('<p>a</p>', { headers: { 'content-security-policy': "default-src 'none'" } })
                is(
                    '…and a route that states its own keeps it',
                    own.headers.get('content-security-policy'),
                    "default-src 'none'",
                )
            },
        },
    ],
})
