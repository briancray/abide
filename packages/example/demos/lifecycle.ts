// The four hooks a process has, and the two functions that run them.
//
// `middleware`, `onStart`, `onStop` and `onError` are the exports `abide dev` and `abide start` will
// read off an app's own module. Until that binary exists they are registrations, exactly as
// `onHealth` and `onIdentity` are, and for the same reason — so what is demonstrated here is what the
// binary will hand each export to, not a stand-in for it.
//
// Three of the four are ONIONS, and that is the whole design: the interesting hook is the one that
// runs on both sides of the thing it wraps. `onStart` binds the socket INSIDE itself, so an app
// cannot take a request against a half-migrated schema; `onStop` drains before the socket closes; a
// middleware rung sees the request going down and the response coming back up. A pair of
// before/after hooks cannot express any of that without a variable held between them.
//
// One claim here needs a socket rather than a card — that a hook which skips `stop()` still leaves a
// closed server behind — and a claim about a PROCESS is one no browser can make. It lives in
// `test/lifecycle.test.ts`, spawned, for the same reason `serve`'s interleaving does.

import { boot, error, handle, json, middleware, onError, onStart, onStop, shutdown } from 'abide/server'
import { suite } from 'abide/tests'
import { capture, writtenAt } from './console.ts'
import { button, row, stage } from './dom.ts'
import { META } from './SUITES.ts'

/** Nothing is upgrading here, so nothing needs the Bun server — and passing one would latch it. */
const NO_SERVER = undefined as never

const HOME = 'https://app.test/'

export default suite({
    ...META.lifecycle,
    cases: [
        {
            title: 'onStart WRAPS the boot — the socket binds inside it',
            note: 'Setup, then `await start()`. The bind runs inside the hook rather than before it, which is the whole reason this wraps instead of preceding: an app whose setup is `await migrate()` must not be able to answer a request against a schema that is halfway migrated, and no ordering of two separate hooks gives it that. What `boot` hands back is what `bind` made, so `boot(() => Bun.serve({ … }))` is a `Server`.',
            async run({ is }) {
                const order: string[] = []

                const off = onStart(async (start) => {
                    order.push('setup')
                    await start()
                    order.push('after')
                })

                const bound = await boot(() => {
                    order.push('bind')
                    return 'the socket'
                })

                is('the setup ran, then the bind, then the rest of the hook', order, [
                    'setup',
                    'bind',
                    'after',
                ])
                is('and boot hands back what bind made', bound, 'the socket')

                off()
                is('no hook is the same boot with nothing around it', await boot(() => 'again'), 'again')
            },
        },

        {
            title: 'a hook that returns without calling start() is a BREAKOUT',
            note: 'Not an error and not a silent success: an app that decided this process should not serve has said so, so `boot` answers `null` and the bind never runs. It is said once on `abide:lifecycle` as a warning in case it was not deliberate — the `DEBUG` gate never swallows one, because the gate is there to control volume rather than to hide breakage.',
            async run({ is }) {
                let bound = false
                const off = onStart(() => {
                    // No `start()`. A licence check failed, a migration refused, an env var is missing.
                })

                // "said once as a warning" is the half `bound` and `answered` cannot see: without
                // the line, a process that decided not to serve is a SILENT success, which is the
                // one outcome the note rules out. Captured rather than asserted on the document,
                // because what reached a console is the whole of a log's observable behaviour.
                let answered: string | null = null
                const written = await capture(async () => {
                    answered = await boot(() => {
                        bound = true
                        return 'the socket'
                    })
                })

                is('nothing bound', bound, false)
                is('and the answer says so', answered, null)
                const warnings = writtenAt(written, 'warn')
                is('said once, and never gated', warnings.length, 1)
                is('on the lifecycle channel', warnings[0]?.text.includes('abide:lifecycle'), true)
                off()
            },
        },

        {
            title: 'onStop mirrors it, and the close is BACKSTOPPED',
            note: 'Drain, then `await stop()`. The asymmetry with `onStart` is deliberate: a hook that never calls `start()` has said the app should not serve, and nothing is harmed. A hook that never calls `stop()` has said nothing at all — it drained and returned — and a process that then goes on listening through its own SIGTERM is the failure a teardown exists to prevent. So the close happens either way, and a hook that THROWS mid-drain does not take it down with it.',
            async run({ is }) {
                const order: string[] = []

                const drains = onStop(async (stop) => {
                    order.push('drain')
                    await stop()
                    order.push('drained')
                })
                await shutdown()
                is('the drain wraps the close', order, ['drain', 'drained'])
                drains()

                let ran = 0
                const skips = onStop(() => {
                    ran++
                    // Never calls `stop()`. The socket closes anyway.
                })
                await shutdown()
                is('a hook that skipped the close still ran', ran, 1)

                // Two signals in quick succession are one teardown that both callers await. The
                // latch is on the teardown IN FLIGHT, so this is one run and not two.
                await Promise.all([shutdown(), shutdown()])
                is('and a teardown in flight is joined, not repeated', ran, 2)
                skips()

                const throws = onStop(() => {
                    throw new Error('the queue would not drain')
                })
                // Nothing is caught here: a drain that failed is still a process on its way out.
                await shutdown()
                is('a hook that threw is a line, not an escape', true, true)
                throws()
            },
        },

        {
            title: 'middleware is one onion around the app’s own routes',
            note: '`next()` takes no arguments, like every other chain in abide, so a rung is the same shape whether it is authorizing, timing or tagging. Rungs run outermost first on the way down and unwind on the way back up, which is what lets one rung both start a clock and read the response it produced. Registering APPENDS where the other three hooks replace — `middleware` is declared as an array because a chain is plural, and two registrations are two rungs in call order.',
            async run({ is }) {
                const order: string[] = []

                const off = middleware(
                    async (next) => {
                        order.push('outer in')
                        const answered = await next()
                        order.push(`outer out ${answered.status}`)
                        return answered
                    },
                    async (next) => {
                        order.push('inner in')
                        return await next()
                    },
                )

                const serving = handle(() => {
                    order.push('route')
                    return json({ ok: true }, { status: 201 })
                })

                const answered = await serving(new Request(HOME), NO_SERVER)
                is('the app answered', answered?.status, 201)
                is('down through both, then back up', order, [
                    'outer in',
                    'inner in',
                    'route',
                    'outer out 201',
                ])

                off()
                order.length = 0
                await serving(new Request(HOME), NO_SERVER)
                is('and off again is the route alone', order, ['route'])
            },
        },

        {
            title: 'a rung short-circuits by ANSWERING or by throwing',
            note: 'A rung that returns a `Response` without calling `next()` is the whole of how a cache hit or a redirect is expressed, and a rung that throws `error("…", 401)` is the whole of how auth refuses — the same `error` an ordinary handler throws, carried to a status by the same path. Nothing under a short circuit runs, which is what makes it one.',
            async run({ is }) {
                let reached = 0
                const serving = handle(() => {
                    reached++
                    return json('the page')
                })

                const answers = middleware(() => json('from the edge', { status: 203 }))
                const cached = await serving(new Request(HOME), NO_SERVER)
                is('the rung answered', cached?.status, 203)
                is('and the route never ran', reached, 0)
                answers()

                const refuses = middleware(() => error(401, 'sign in first'))
                const refused = await serving(new Request(HOME), NO_SERVER)
                is('a throw is a status', refused?.status, 401)
                is('carrying the failure', await refused?.json(), {
                    error: { name: 'HttpError', message: 'sign in first' },
                })
                is('and the route still never ran', reached, 0)
                refuses()

                await serving(new Request(HOME), NO_SERVER)
                is('with no rung at all the route runs', reached, 1)
            },
        },

        {
            title: 'abide’s own endpoints are served IN FRONT of the onion',
            note: 'A websocket upgrade has no response — Bun answers the handshake itself — so a rung wrapping one could not keep the `Promise<Response>` its own signature promises. Everything under `/__abide/` already gates itself per DECLARATION anyway: `GET(fn, { middleware })` and `socket({ middleware })` are the rungs for a call and a subscribe, and they see the args and the room, which an onion over the raw request never could.',
            async run({ is }) {
                let rungs = 0
                let routes = 0
                const off = middleware(async (next) => {
                    rungs++
                    return await next()
                })
                const serving = handle(() => {
                    routes++
                    return json('the page')
                })

                const health = await serving(new Request(`${HOME}__abide/health`), NO_SERVER)
                is('abide answered', health?.status, 200)
                is('the app’s chain did not run', rungs, 0)
                is('and neither did its routes', routes, 0)

                await serving(new Request(HOME), NO_SERVER)
                is('the app’s own path is the app’s', [rungs, routes], [1, 1])
                off()
            },
        },

        {
            title: 'onError is for the UNEXPECTED one, and a route that answered nothing is a 404',
            note: 'A DELIBERATE outcome never reaches it: `error(404, "no user")` is a guard an author wrote, and a hook that ran for every one of those is a hook every app has to filter — with the filter being this same test, written a second time. What reaches it is what escaped. Returning a `Response` from it is the answer sent; returning anything else falls through to the ordinary 500, so a hook that only wants to report a failure returns nothing.',
            async run({ is }) {
                const seen: unknown[] = []
                const off = onError((failure) => {
                    seen.push((failure as Error).message)
                })

                const deliberate = handle(() => error(404, 'no user'))
                is(
                    'a deliberate outcome is its own status',
                    (await deliberate(new Request(HOME), NO_SERVER))?.status,
                    404,
                )
                is('and never reaches the hook', seen.length, 0)

                const broken = handle(() => {
                    throw new TypeError('cannot read id of undefined')
                })
                const failed = await broken(new Request(HOME), NO_SERVER)
                is('an unexpected one is a 500', failed?.status, 500)
                is('and the hook saw it', seen, ['cannot read id of undefined'])
                off()

                const answers = onError(() => json({ sorry: true }, { status: 503 }))
                is('a hook may answer', (await broken(new Request(HOME), NO_SERVER))?.status, 503)
                answers()

                // Nothing matched, and the app said so by returning nothing at all.
                const empty = handle(() => undefined)
                const missing = await empty(new Request(`${HOME}nowhere`), NO_SERVER)
                is('a route that answered nothing is a 404', missing?.status, 404)
                is('naming the path', await missing?.json(), {
                    error: { name: 'AbideRouteError', message: 'nothing is served at /nowhere' },
                })
            },
        },

        {
            title: 'interact — run a request through a chain you assemble',
            interact({ host, log }) {
                const trail: string[] = []
                let off: (() => void) | null = null

                const serving = handle((request) => {
                    trail.push(`route ${new URL(request.url).pathname}`)
                    return json('the page')
                })

                const send = async (path: string): Promise<void> => {
                    trail.length = 0
                    const answered = await serving(new Request(`${HOME}${path}`), NO_SERVER)
                    log.live('trail', `${answered?.status} · ${trail.join(' → ')}`)
                }

                host.append(
                    stage(
                        row(
                            button('add a timing rung', () => {
                                off?.()
                                off = middleware(async (next) => {
                                    const at = performance.now()
                                    const answered = await next()
                                    trail.push(`took ${(performance.now() - at).toFixed(2)}ms`)
                                    return answered
                                })
                                log.live('trail', 'a rung is on')
                            }),
                            button('add a refusing rung', () => {
                                off?.()
                                off = middleware(() => error(401, 'sign in first'))
                                log.live('trail', 'a rung is on')
                            }),
                            button('take it off', () => {
                                off?.()
                                off = null
                                log.live('trail', 'no rungs')
                            }),
                            button('GET /', () => void send('')),
                            button('GET /__abide/health', () => void send('__abide/health')),
                        ),
                    ),
                )
                log('trail', '—')
            },
        },
    ],
})
