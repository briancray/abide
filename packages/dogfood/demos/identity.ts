// Who the server decided this caller is.
//
// `identity()` is the isomorphic ask and it is always a promise, on both sides — a call whose return
// type differed between the lanes would not be one call. What differs underneath is where the answer
// comes from: the process SERVING the caller composes it out of the sealed cookie, and anyone else
// asks `/__abide/identity` and takes what comes back.
//
// Two things are worth watching here because they are the ones a hand-written session gets wrong.
// The first is that a principal is never null — an anonymous visitor is `{ authenticated: false }`,
// so a reader never writes the null check that half of them get wrong. The second is that the client
// never GUESSES: the two writers are the server's, and calling one in a browser is a message rather
// than a silently different answer.
//
// Everything that needs a REQUEST — the seal round-trip, the rolling refresh, a resolver's claims —
// is in `packages/dogfood/test/serve.test.ts` beside the other request-scoped ambients, because
// `serve()` needs an `AsyncLocalStorage` and a browser has none. What is left here is what is true
// in both lanes, and every case below is written so that it is.

import { identity } from 'abide'
import { onIdentity } from 'abide/server'
import { loopback, suite } from 'harness'
import { button, row, stage } from './dom.ts'
import { META } from './SUITES.ts'

const IDENTITY = '/__abide/identity'

export default suite({
    ...META.identity,
    cases: [
        {
            title: 'a principal is never null — anonymous is an answer, not an absence',
            note: 'There is no caller here: headless nothing has called `serve()`, and in the browser card there is no request scope at all. Both lanes therefore ask over the wire and read the same document back, which is the whole claim — `{ authenticated: false }` is a complete principal, so a reader asks one question instead of writing a null check and getting the failure mode of forgetting it. `expiresAt` is absent rather than null because there is no seal to lapse. The wire is NAMED rather than left to the ambient one, for the reason `health()` takes the same option: a relative address needs a page to be relative to. And the ask is COUNTED, because the anonymous floor is also what a held answer and a local source hand back: the count is what says this document came off the wire rather than out of either. Whether the endpoint answered it CORRECTLY is the third case below, which asserts the status and the headers — a floor that arrived because nothing answered looks identical here, and pretending otherwise would be the same un-failable assertion in a new spelling.',
            async run({ is }) {
                const wire = loopback()
                let asked = 0
                const who = await identity({
                    fetch: (input, init) => {
                        asked++
                        return wire.fetch(input, init)
                    },
                })

                is('a document, not a null', typeof who, 'object')
                is('and it says so plainly', who.authenticated, false)
                is('nothing to lapse', who.expiresAt, undefined)
                is('and no resolver failed', who.error, undefined)
                is('and it came off the wire, not out of a local source', asked, 1)
            },
        },

        {
            title: 'the two writers are the server’s, and say so where they are not',
            note: 'A client that could write its own principal is a client that decides who it is, which is the one thing this ambient exists to prevent. They are on the type in both lanes rather than missing from one, so the mistake is a message naming the call instead of a property that is undefined — and the message points at where a login actually goes, which is a handler declared through `abide/server`. `invalidate()` is not a writer: it forgets what was resolved so the next ask does it again, which is what a browser calls after the rpc that signed it in.',
            run({ is, throws }) {
                throws('set is not the caller’s', () => identity.set({ id: 'u1' }), 'is the server')
                throws('nor is clear', () => identity.clear(), 'is the server')

                // The one verb that is safe anywhere: it drops what was remembered and starts
                // nothing, so there is no answer for it to invent.
                identity.invalidate()
                is('invalidate is not a write', typeof identity.invalidate, 'function')
            },
        },

        {
            title: 'the endpoint is that same document',
            note: '`GET /__abide/identity`, served by `dispatch` — an app that mounted that has it already. Open, and for a stronger reason than the health document or the schema catalogue: the whole answer is composed from the cookie this caller sent, so a caller can only ever learn about ITSELF and there is nothing to enumerate. `no-store` is the header the other two do not need — a response that is per-caller by construction is one that must not be cached between here and the browser.',
            async run({ is }) {
                const wire = loopback()

                const answered = await wire.fetch(IDENTITY, { method: 'GET' })
                is('open', answered.status, 200)
                is('one JSON document', answered.headers.get('content-type'), 'application/json')
                is('and never cached', answered.headers.get('cache-control'), 'no-store')

                const who = (await answered.json()) as { authenticated: boolean }
                is('a caller that sent no cookie is anonymous', who.authenticated, false)

                is('and it is a GET', (await wire.fetch(IDENTITY, { method: 'POST' })).status, 405)
            },
        },

        {
            title: 'a resolver is registered, and hands back the way off',
            note: 'Optional, because without one the sealed claims ARE the principal — `identity.set({ id, name })` and `identity()` hands both back, which is the whole of what a small app needs. A resolver is what an app reaches for when the cookie should carry an id and the principal should carry a row. One app has one answer to “who is this”, so a second registration REPLACES rather than merging: two resolvers need an order, and an order nobody declared is one the import graph picks.',
            run({ is }) {
                const off = onIdentity((claims) => ({ ...(claims as object), role: 'admin' }))
                is('registration hands back a disposer', typeof off, 'function')

                const second = onIdentity(() => ({ role: 'reader' }))
                // The first disposer no longer owns the hook, so calling it must not reach past
                // itself and clear the registration that replaced it.
                off()
                second()
                is('and the second one takes its own off', typeof second, 'function')
            },
        },

        {
            title: 'interact — ask, and try to answer for yourself',
            // Nothing here can sign anybody in: there is no request scope in a browser, which is
            // exactly the boundary the two refusals draw. The card shows the boundary rather than
            // pretending to a login it cannot perform.
            interact({ host, log }) {
                const show = async (): Promise<void> => {
                    log.live('identity', JSON.stringify(await identity()))
                }

                const refused = (label: string, attempt: () => unknown) =>
                    button(label, () => {
                        try {
                            attempt()
                            log.live('attempt', 'it went through — which on a client it must not')
                        } catch (refusal) {
                            log.live('attempt', String((refusal as Error).message))
                        }
                    })

                host.append(
                    stage(
                        row(
                            button('ask', () => void show()),
                            refused('identity.set({ id: "u1" })', () => identity.set({ id: 'u1' })),
                            refused('identity.clear()', () => identity.clear()),
                            button('invalidate, then ask', () => {
                                identity.invalidate()
                                void show()
                            }),
                        ),
                    ),
                )
                log('identity', '—')
                log('attempt', '—')
            },
        },
    ],
})
