// `rpc = memo + transport` and `socket = channel + transport`, both laws, at the size they claim.
//
// The whole argument is that the right-hand sides are already written: an rpc IS a keyed memo whose
// body happens to be a fetch, so `u({id})()`, `await u({id})`, `.peek()`, `.pending()` and
// `.invalidate()` need no transport-shaped vocabulary of their own — and three concurrent readers of
// one key cost one request because the SLOT coalesces, which it already did for a local load.
//
// The cases below run against `loopback()`: `dispatch` called in-process, so the same body makes the
// same claims headless and inside a browser card. What that cannot show — a real socket, a real
// reconnect, and a handler's body actually absent from a bundle — is in
// `packages/example/test/transport.test.ts`, which spawns a lane with no DOM emulator in it.
//
// This page imports `abide/compiler` for the elision case, and therefore ships TypeScript's scanner.
// That is deliberate: the claim a reader comes here for is "the browser gets the address and not the
// body", and moving it to another page to save a page nobody profiles would be hiding it.

import {
    type RemoteOptions,
    type RemoteSocket,
    type RemoteSocketOptions,
    type RoomChannel,
    type Rpc,
    remote,
    remoteSocket,
} from 'abide'
import { ElisionError, elide, endpointId, kindOf } from 'abide/compiler'
import {
    DELETE,
    error,
    GET,
    type HttpError,
    json,
    jsonl,
    POST,
    page,
    redirect,
    register,
    socket,
    sse,
} from 'abide/server'
import { loopback, reader, sleep, suite, until } from 'abide/tests'
import { button, el, field, row, stage } from './dom.ts'
import { META } from './SUITES.ts'
import * as vanilla from './vanilla.ts'

const USERS = '/app/server/rpc/users.ts'
const AUDIT = '/app/server/rpc/admin/audit.ts'
const FEED = '/app/server/sockets/feed.ts'

/** One `dispatch`, shared by the cases, so the request counter is the whole transport's. */
const wire = loopback()

// A stub the compiler wrote takes its transport from the lane it is loaded in; a case has to say.
// Said ONCE here, so what a case shows is the claim and not the wiring — these two are exactly what
// the browser's own `remote(id)` / `remoteSocket(id)` are, with the fetch pointed in-process.
function client<Args, T>(id: string, extra?: Omit<RemoteOptions, 'base' | 'fetch'>): Rpc<Args, T> {
    return remote<Args, T>(id, { base: wire.base, fetch: wire.fetch, ...extra })
}

function sock<T, Args = void>(
    id: string,
    extra?: Omit<RemoteSocketOptions, 'base' | 'open'>,
): RemoteSocket<T, Args> {
    return remoteSocket<T, Args>(id, { base: wire.base, open: wire.open, ...extra })
}

function find(id: number): { id: number; name: string } {
    return { id, name: `user ${id}` }
}

export default suite({
    ...META.transport,
    cases: [
        {
            title: 'a read is a keyed memo whose body is a fetch',
            note: "Both halves of the law return the SAME THING — a keyed memo — so the caller's whole vocabulary is already written and identical on both sides. The CALL selects a slot and starts nothing; the READ is what reaches the server, which is why `peek` and the probes still answer on a cold key.",
            async run({ is }) {
                const getUser = GET(({ id }: { id: number }) => find(id))
                register('rpc', [['demo/read/getUser', 'getUser']], { getUser })
                const remoteUser = client<{ id: number }, { id: number; name: string }>('demo/read/getUser')

                is('selecting a slot starts nothing — peek()', remoteUser({ id: 7 }).peek(), undefined)
                is('…and pending()', remoteUser({ id: 7 }).pending(), false)

                is('the value came over the wire', await remoteUser({ id: 7 }), { id: 7, name: 'user 7' })
                is('…and is retained after it', remoteUser({ id: 7 }).peek(), { id: 7, name: 'user 7' })
                is('settled()', remoteUser({ id: 7 }).settled(), true)
                is('error()', remoteUser({ id: 7 }).error(), undefined)

                // The server holds the same declaration, and it is a memo there too — no transport
                // at all, because the handler is right here.
                is('in-process, the same call', await getUser({ id: 7 }), { id: 7, name: 'user 7' })

                remoteUser.invalidate({ id: 7 })
                is('and the verbs mean what they mean everywhere', remoteUser({ id: 7 }).peek(), undefined)
            },
            interact({ host, log }) {
                const getUser = GET(({ id }: { id: number }) => find(id))
                register('rpc', [['demo/live/getUser', 'getUser']], { getUser })
                const remoteUser = client<{ id: number }, { id: number; name: string }>('demo/live/getUser')
                let id = 1
                const out = stage(host)
                const shown = el('p', 'text-lg text-slate-100 min-h-7')
                out.append(shown)
                reader(() => {
                    const slot = remoteUser({ id })
                    shown.textContent = slot.pending() ? 'loading…' : (slot.peek()?.name ?? '(nothing yet)')
                    log.live('peek()', slot.peek())
                    log.live('pending()', slot.pending())
                    log.live('settled()', slot.settled())
                })
                host.append(
                    row(
                        button('read user 1', () => {
                            id = 1
                            remoteUser({ id })()
                        }),
                        button('read the next user', () => {
                            id++
                            remoteUser({ id })()
                        }),
                        button('invalidate every slot', () => remoteUser.invalidate()),
                    ),
                    field('read a specific id', (value) => {
                        const parsed = Number(value)
                        if (Number.isFinite(parsed)) {
                            id = parsed
                            remoteUser({ id })()
                        }
                    }),
                )
            },
        },

        {
            title: 'three concurrent readers of one key cost ONE request',
            note: 'The whole case for `rpc = memo + transport`. Nothing in the transport coalesces — the slot does, exactly as it already did for a local load. A hand-written client gets this by writing it a third time, next to the handler and the route.',
            async run({ is }) {
                const one = GET(async ({ id }: { id: number }) => {
                    await sleep(2)
                    return find(id)
                })
                register('rpc', [['demo/coalesce/one', 'one']], { one })
                const remoteOne = client<{ id: number }, { id: number; name: string }>('demo/coalesce/one')

                const before = wire.requests
                const all = await Promise.all([
                    remoteOne({ id: 3 }),
                    remoteOne({ id: 3 }),
                    remoteOne({ id: 3 }),
                ])
                is('three readers, one request', wire.requests - before, 1)
                is('…and all three got the value', all, [find(3), find(3), find(3)])

                const second = wire.requests
                await remoteOne({ id: 4 })
                is('a different key is a different slot', wire.requests - second, 1)
            },
            bench: {
                kind: 'budget',
                arms: (() => {
                    const READERS = 8
                    const answer = { id: 1, name: 'user 1' }
                    let served = 0
                    const counted = GET(async () => {
                        served++
                        return answer
                    })
                    register('rpc', [['demo/bench/one', 'counted']], { counted })
                    const byHand = (): Promise<{ id: number; name: string }> => {
                        served++
                        return Promise.resolve(answer)
                    }
                    return [
                        {
                            label: 'abide — 8 readers of one key',
                            async run() {
                                const call = client<{ id: number }, unknown>('demo/bench/one')
                                served = 0
                                const waiting = []
                                for (let i = 0; i < READERS; i++) waiting.push(call({ id: 1 }))
                                await Promise.all(waiting)
                                return { count: served, of: 'requests' }
                            },
                        },
                        {
                            label: 'vanilla — a cache, written a third time',
                            async run() {
                                const cache = vanilla.keyedCache(byHand)
                                served = 0
                                const waiting = []
                                for (let i = 0; i < READERS; i++) waiting.push(cache.load('1'))
                                await Promise.all(waiting)
                                return { count: served, of: 'requests' }
                            },
                        },
                        {
                            label: 'vanilla — no cache',
                            async run() {
                                const cache = vanilla.keyedCache(byHand)
                                served = 0
                                const waiting = []
                                for (let i = 0; i < READERS; i++) waiting.push(cache.loadNaive('1'))
                                await Promise.all(waiting)
                                return { count: served, of: 'requests' }
                            },
                        },
                    ]
                })(),
            },
        },

        {
            title: 'a read retains what it loaded; a mutation retains nothing',
            note: 'The one thing the five names decide. `GET` travels as an HTTP GET with its args in the query, so an address says what it is and an intermediary may cache it; a mutation travels as its own method with a body, and its slot is `ttl: 0` — it still coalesces the callers waiting on one call in flight, and the next read runs the handler again.',
            async run({ is }) {
                const written: string[] = []
                const getName = GET(({ id }: { id: number }) => find(id).name)
                const rename = POST(({ id, name }: { id: number; name: string }) => {
                    written.push(`${id}:${name}`)
                    return { id, name }
                })
                const forget = DELETE(({ id }: { id: number }) => {
                    written.push(`drop ${id}`)
                    return { dropped: id }
                })
                register(
                    'rpc',
                    [
                        ['demo/retain/getName', 'getName'],
                        ['demo/retain/rename', 'rename'],
                        ['demo/retain/forget', 'forget'],
                    ],
                    { getName, rename, forget },
                )
                const remoteName = client<{ id: number }, string>('demo/retain/getName')
                const remoteRename = client<{ id: number; name: string }, unknown>('demo/retain/rename', {
                    method: 'POST',
                })

                const before = wire.requests
                await remoteName({ id: 1 })
                await remoteName({ id: 1 })
                is('a read is served from the slot the second time', wire.requests - before, 1)

                await remoteRename({ id: 1, name: 'ada' })
                await remoteRename({ id: 1, name: 'ada' })
                is('a mutation runs every time it is called', written, ['1:ada', '1:ada'])

                is('and the method is the declaration', remoteRename.method, 'POST')
                is('…on the server half too', forget.method, 'DELETE')
            },
            bench: {
                kind: 'time',
                floor: 'flush',
                arms: (() => {
                    // One COLD read each: the whole round trip, against the same round trip written
                    // by hand. A warm read would measure the memo's keyed lookup, which the memo
                    // suite already benches — this one has to distinguish the transport or it is not
                    // worth a row.
                    const round = GET(({ id }: { id: number }) => find(id))
                    register('rpc', [['demo/bench/round', 'round']], { round })
                    const call = client<{ id: number }, unknown>('demo/bench/round')
                    const byHand = vanilla.remoteByHand('/api/user', ({ id }: { id: number }) => find(id))
                    return [
                        {
                            label: 'abide — one read over the transport, cold',
                            run: async () => {
                                call.invalidate()
                                return call({ id: 1 })
                            },
                        },
                        {
                            label: 'vanilla — handler + route + stub, by hand',
                            run: () => byHand({ id: 1 }),
                        },
                    ]
                })(),
            },
        },

        {
            title: 'a failure crosses the wire with its NAME',
            note: "A failed load throws from the READ, which is the cell's rule already — so a transport failure needs no error path of its own. What the transport does have to carry is the NAME: an error that crossed a wire arrives as a plain object, so `instanceof` on it is false however faithfully it was serialised, and `isError(e, name)` is the question that outlives the constructor.",
            async run({ is, rejects }) {
                // `error.typed` is the declaration of that name, once, and it is what the handler
                // fails with — a `never`, so the checker knows the line after it is unreachable.
                const notFound = error.typed('NotFound', 404)
                const getUser = GET(({ id }: { id: number }) => notFound(`no user ${id}`))
                register('rpc', [['demo/fail/getUser', 'getUser']], { getUser })
                const remoteUser = client<{ id: number }, unknown>('demo/fail/getUser')

                await rejects('the read rejects', remoteUser({ id: 9 }), /no user 9/)
                is('the status came with it', (await remoteUser.raw({ id: 9 })).status, 404)
                let caught: unknown
                try {
                    remoteUser({ id: 9 })()
                } catch (error) {
                    caught = error
                }
                is('the name survived the wire', remoteUser({ id: 9 }).isError(caught, 'NotFound'), true)
                is('instanceof would not have', caught instanceof TypeError, false)
                is('and the probe never throws', remoteUser({ id: 9 }).peek(), undefined)

                const missing = client<unknown, unknown>('demo/fail/nowhere')
                await rejects('an endpoint that is not there', missing({}), /no endpoint/)
            },
        },

        {
            title: 'an app’s own route answers with a Response',
            note: 'abide serves `/__abide/**` and hands back nothing at all for anything else — so an app’s own routes are ordinary `Bun.serve` routes, and these are the shapes they answer with. Every one of them IS a `Response`, so a route that outgrows them drops to `new Response(...)` and loses nothing. `error` is the odd one out and throws, because an rpc handler’s return type is its VALUE: a failure has nowhere to go but out.',
            async run({ is, rejects }) {
                async function* counting(): AsyncGenerator<number> {
                    yield 1
                    yield 2
                    yield 3
                }

                const one = json({ id: 7 })
                is('json is a JSON body', await one.json(), { id: 7 })
                is('…tagged as one', one.headers.get('content-type'), 'application/json')
                // `undefined` is not JSON, so a route that answered with nothing would otherwise
                // send the literal text `undefined`, which no decoder accepts.
                is('a route that returned nothing sends null', await json(undefined).text(), 'null')

                is('jsonl is one JSON value per line', await jsonl([1, 2, 3]).text(), '1\n2\n3\n')
                is('…from a sync iterable or an async one', await jsonl(counting()).text(), '1\n2\n3\n')
                is('…and says so', jsonl([]).headers.get('content-type'), 'application/jsonl')

                const events = sse(counting())
                is(
                    'sse is the same machine, framed',
                    await events.text(),
                    'data: 1\n\ndata: 2\n\ndata: 3\n\n',
                )
                is('…and told nothing may buffer it', events.headers.get('x-accel-buffering'), 'no')

                // The status line is already out by the time a stream fails, so the body is the only
                // thing left to say it with — and to a consumer of the raw response that reads as a
                // truncated one, which is what HTTP has.
                async function* stops(): AsyncGenerator<number> {
                    yield 1
                    throw new Error('the source gave up')
                }
                await rejects('a source that throws mid-stream', jsonl(stops()).text(), /gave up/)

                // An ordinary header rather than the `set-cookie` this exists for: a browser hides
                // that one from `headers.get`, and this case runs in a card as well as headless.
                const away = redirect('/login', 303, { headers: { 'x-from': '/admin' } })
                is('redirect names a location', away.headers.get('location'), '/login')
                is('…with a status only the 3xx literals type-check as', away.status, 303)
                is(
                    '…and headers of its own, which is where a login puts its cookie',
                    away.headers.get('x-from'),
                    '/admin',
                )
                is('the default is 302', redirect('/login').status, 302)

                // `page` takes what a render PRODUCED rather than doing the render, so one helper
                // serves `renderToString`, `toStream` and `renderDocument` — and a document stops
                // being the one response an app serves that this file never touched.
                const document = page('<!doctype html><p>hi</p>')
                is('page is a document', await document.text(), '<!doctype html><p>hi</p>')
                is('…tagged as one', document.headers.get('content-type'), 'text/html; charset=utf-8')

                let caught: unknown
                try {
                    error('that is not a number', 422)
                } catch (failure) {
                    caught = failure
                }
                is('error throws its status', (caught as HttpError).status, 422)
                is('…and a typed one throws its name', error.typed('Forbidden', 403).kind, 'Forbidden')
            },
        },

        {
            title: 'every response abide builds names the operation that answered it',
            note: '`traceresponse` is the W3C header a caller stitches its own span to, and it goes on through one funnel — so an answer, a refusal and the 404 for an address nobody registered all carry it. A failure is the response you most want to correlate, which is why the refusals are the point rather than the exception. The scope it is read from is opened by `dispatch` itself, so an app that mounted `dispatch` and nothing else has this already.',
            async run({ is }) {
                const parent = /^00-([\da-f]{32})-([\da-f]{16})-[\da-f]{2}$/

                const getUser = GET(({ id }: { id: number }) => find(id))
                register('rpc', [['demo/traced/getUser', 'getUser']], { getUser })

                const answered = await wire.fetch(
                    `/__abide/rpc/demo/traced/getUser?a=${encodeURIComponent('{"id":1}')}`,
                    {},
                )
                is('a call that answered', await answered.json(), { id: 1, name: 'user 1' })
                is('…carries it', parent.test(answered.headers.get('traceresponse') ?? ''), true)

                // The refusals are the whole claim: each of these returns from a DIFFERENT point in
                // `dispatch`, and a header applied per-lane would have been missed by at least one.
                const missing = await wire.fetch('/__abide/rpc/nobody/registered/this', {})
                is('a 404 for an unregistered id', missing.status, 404)
                is('…carries it too', parent.test(missing.headers.get('traceresponse') ?? ''), true)

                const nowhere = await wire.fetch('/__abide/not-a-lane', {})
                is('so does the refusal for a path no lane claims', nowhere.status, 404)
                is('…with an id of its own', parent.test(nowhere.headers.get('traceresponse') ?? ''), true)

                // The whole value of Trace Context is that the id is the CALLER's when there is one:
                // the span is ours, so the caller stitches its own to the entry point we answered at.
                const carried = '00-1234567890abcdef1234567890abcdef-abcdef1234567890-01'
                const continued = await wire.fetch('/__abide/rpc/nobody/registered/this', {
                    headers: { traceparent: carried },
                })
                const matched = parent.exec(continued.headers.get('traceresponse') ?? '')
                is('an inbound traceparent is CONTINUED', matched?.[1], '1234567890abcdef1234567890abcdef')
                is('…with a span of ours, not the caller’s', matched?.[2] !== 'abcdef1234567890', true)

                // Two requests are two operations. The ids differing is what makes correlating by one
                // mean anything at all.
                const second = await wire.fetch('/__abide/rpc/nobody/registered/this', {})
                is(
                    'two requests are two operations',
                    missing.headers.get('traceresponse') !== second.headers.get('traceresponse'),
                    true,
                )
            },
        },

        {
            title: 'a handler that yields is a stream on both sides',
            note: 'A generator declaration is recognised from the function itself, so the browser lane knows to read the response as chunks without a type-checker. The cell does the rest: it holds the LATEST chunk, `chunks()` holds the transcript, and a second consumer replays what already arrived before following what comes next.',
            async run({ is }) {
                const countdown = GET(async function* ({ from }: { from: number }) {
                    for (let n = from; n > 0; n--) yield n
                })
                register('rpc', [['demo/stream/countdown', 'countdown']], { countdown })
                const remoteCountdown = client<{ from: number }, number>('demo/stream/countdown', {
                    stream: true,
                })

                const got: number[] = []
                for await (const n of remoteCountdown({ from: 3 })) got.push(n)
                is('the loop received every chunk', got, [3, 2, 1])
                is('chunks() is the transcript', remoteCountdown({ from: 3 }).chunks(), [3, 2, 1])
                is('and the read is the LATEST chunk', remoteCountdown({ from: 3 })(), 1)

                // The replay is what makes it a slot rather than a subscription.
                const again: number[] = []
                for await (const n of remoteCountdown({ from: 3 })) again.push(n)
                is('a second consumer replays the whole of it', again, [3, 2, 1])
                is('…without going back to the server', remoteCountdown({ from: 3 }).streaming(), false)
            },
            interact({ host, log }) {
                const ticker = GET(async function* ({ from }: { from: number }) {
                    for (let n = from; n > 0; n--) {
                        await sleep(400)
                        yield n
                    }
                })
                register('rpc', [['demo/live/ticker', 'ticker']], { ticker })
                const remoteTicker = client<{ from: number }, number>('demo/live/ticker', { stream: true })
                const out = stage(host)
                const shown = el('p', 'text-3xl font-semibold text-slate-100 tabular-nums', '—')
                out.append(shown)
                const from = 5
                reader(() => {
                    const slot = remoteTicker({ from })
                    shown.textContent = String(slot.peek() ?? '—')
                    log.live('chunks()', slot.chunks())
                    log.live('streaming()', slot.streaming())
                    log.live('done()', slot.done())
                })
                host.append(
                    row(
                        button('stream a countdown', () => remoteTicker({ from })()),
                        button('replay it (no request)', () => {
                            void (async () => {
                                const seen: number[] = []
                                for await (const n of remoteTicker({ from })) seen.push(n)
                                log('replayed', seen)
                            })()
                        }),
                        button('invalidate and re-stream', () => {
                            remoteTicker.invalidate()
                            remoteTicker({ from })()
                        }),
                    ),
                )
            },
        },

        {
            title: 'middleware runs for every caller, including the in-process one',
            note: 'The chain authorizes and observes the CALL, not the request — so a handler another handler calls directly goes through the same rungs, which is the half a request-level middleware cannot reach. `next()` takes no arguments, like every onion in abide; the args are beside it, because an authorization that cannot see what was asked for can only ever be per-endpoint.',
            async run({ is, rejects }) {
                const rungs: string[] = []
                const readSecret = GET(
                    ({ id }: { id: number }) => {
                        rungs.push('handler')
                        return `secret ${id}`
                    },
                    {
                        middleware: [
                            (next, args) => {
                                rungs.push(`outer ${args.id}`)
                                const produced = next()
                                rungs.push('outer done')
                                return produced
                            },
                            (next, args) => {
                                if (args.id === 0) throw new Error('not yours')
                                rungs.push('inner')
                                return next()
                            },
                        ],
                    },
                )
                register('rpc', [['demo/chain/readSecret', 'readSecret']], { readSecret })
                const remoteSecret = client<{ id: number }, string>('demo/chain/readSecret')

                is('over the wire', await remoteSecret({ id: 1 }), 'secret 1')
                is('the chain ran outside in', rungs, ['outer 1', 'inner', 'handler', 'outer done'])

                // A DIFFERENT key, deliberately: with a request scope the wire call's slot went away
                // with its request, and without one — a browser dispatching to itself — it did not.
                // Asking the same key would be asking which lane this is.
                rungs.length = 0
                is('in-process, the same chain', await readSecret({ id: 2 }), 'secret 2')
                is('…rung for rung', rungs, ['outer 2', 'inner', 'handler', 'outer done'])

                await rejects('a refusal is a throw', remoteSecret({ id: 0 }), /not yours/)
            },
        },

        {
            title: 'the browser lane gets the address, and none of the body',
            note: "The DIRECTORY is the kind, so the lane knows which stub to write before it reads the file, and the module's own path is the address — there is no hash, because two endpoints can only collide if two files do. An endpoint is recognised SYNTACTICALLY, the same rule `.abide` lives by: the emit path must not need a type-checker, because the browser produces the stub from a file it is about to throw away.",
            async run({ is, throws }) {
                const source = [
                    `import { findUser } from '../db.ts'`,
                    `import { GET } from 'abide/server'`,
                    ``,
                    `export const getUser = GET(({ id }: { id: number }) => findUser(id))`,
                ].join('\n')

                is('the directory is the kind', kindOf(USERS), 'rpc')
                is('…and a socket directory is the other one', kindOf(FEED), 'socket')
                is('a file under neither declares nothing', kindOf('/app/server/db.ts'), null)

                is('the module path is the address', endpointId(USERS, 'getUser'), 'users/getUser')
                is('subdirectories included', endpointId(AUDIT, 'recent'), 'admin/audit/recent')

                const browser = elide(source, { filename: USERS, browser: true })
                const server = elide(source, { filename: USERS })
                is('the stub carries the address', browser?.code.includes('"users/getUser"'), true)
                is('…and none of the handler', browser?.code.includes('findUser'), false)
                is('the server lane keeps the module', server?.code.includes('findUser'), true)
                is('…and appends its own address', server?.code.includes('"users/getUser"'), true)
                // Appended rather than woven in, so every line the author wrote keeps its number.
                is('the module is still line one', server?.code.startsWith(source), true)

                const yielding = `export const feed = GET(async function* () { yield 1 })\n`
                is(
                    'a handler that yields says so in the stub',
                    elide(yielding, { filename: USERS, browser: true })?.code.includes('stream: true'),
                    true,
                )

                throws(
                    'a non-endpoint export is an error naming the export',
                    () => elide(`export function helper() { return 1 }\n`, { filename: USERS }),
                    /exports `function`/,
                )
                throws(
                    'a socket under an rpc directory is an error naming both',
                    () => elide(`export const feed = socket<number>()\n`, { filename: USERS }),
                    /`feed` with `socket`/,
                )
                is(
                    '…and it is fine where it belongs',
                    elide(`export const ticks = socket<number>()\n`, { filename: FEED })?.endpoints,
                    [{ name: 'ticks', method: 'socket', streams: false }],
                )
                is(
                    'the error is one a shell can place in the file',
                    (() => {
                        try {
                            elide(`export let x = 1\n`, { filename: USERS })
                            return 'no throw'
                        } catch (error) {
                            return error instanceof ElisionError
                        }
                    })(),
                    true,
                )
            },
        },

        {
            title: 'a socket is `channel()` with subscribers that arrived over a wire',
            note: 'The server half is `channel()` UNCHANGED — the transport is not in the channel, it is one `subscribe` on upgrade and one unsubscribe on close. Both sides are a `Channel`, so a component iterating one, calling one, or reading `chunks()` cannot tell which side it is on.',
            async run({ is }) {
                const ticks = socket<{ n: number }>({ channel: { tail: 8 } })
                register('socket', [['demo/socket/ticks', 'ticks']], { ticks })
                const remoteTicks = sock<{ n: number }>('demo/socket/ticks', { channel: { tail: 8 } })

                is('nothing has arrived', remoteTicks.peek(), undefined)
                const upgraded = wire.connected
                // The READ is what opens the connection; a probe never does.
                remoteTicks()
                // Waited for, not slept past: the upgrade is a detached turn of the loop, and a
                // publish that beats it is dropped rather than queued.
                await until(() => wire.connected > upgraded)

                // Published on the SERVER, into a plain channel. Nothing about the publish knows a
                // socket exists.
                ticks.publish({ n: 1 })
                ticks.publish({ n: 2 })
                await until(() => remoteTicks.chunks().length === 2)

                is('the client channel holds the transcript', remoteTicks.chunks(), [{ n: 1 }, { n: 2 }])
                is('…and the latest', remoteTicks.peek(), { n: 2 })
                is('the whole source surface answers', remoteTicks.settled(), true)
                is('a channel never loads, so it never ends', remoteTicks.done(), false)
                remoteTicks.close()
            },
            interact({ host, log }) {
                const feed = socket<string>({ channel: { tail: 6 } })
                register('socket', [['demo/live/feed', 'feed']], { feed })
                const remoteFeed = sock<string>('demo/live/feed', { channel: { tail: 6 } })
                const out = stage(host)
                const shown = el('p', 'font-mono text-xs text-emerald-300 min-h-5')
                out.append(shown)
                reader(() => {
                    shown.textContent = remoteFeed.chunks().join(' · ') || '(nothing yet)'
                    log.live('client peek()', remoteFeed.peek())
                })
                let n = 0
                host.append(
                    row(
                        button('publish on the SERVER', () => feed.publish(`tick ${++n}`)),
                        button('close the connection', () => {
                            remoteFeed.close()
                            log('closed', 'the server keeps publishing; nothing arrives')
                        }),
                    ),
                )
            },
        },

        {
            title: 'rooms, and the publish a client is only allowed if the server says so',
            note: 'A socket splits into rooms the way a channel does — the CALL selects one — and the room travels in the address, so the subscribe on the server is `ch(args).subscribe(…)` and nothing else. `clientPublish` is a POLICY: a socket is a broadcast until an app says otherwise, because a client that may publish into a room may write to every subscriber of it.',
            async run({ is }) {
                // Annotated because the policy names the socket it publishes into — a declaration
                // that reads its own name needs a type to stand on while it is being written.
                const open: RoomChannel<{ room: string }, string> = socket<string, { room: string }>({
                    channel: { tail: 4 },
                    clientPublish: (message, room) => {
                        open(room as { room: string }).publish(`echoed: ${String(message)}`)
                    },
                })
                const shut = socket<string, { room: string }>({ channel: { tail: 4 } })
                register(
                    'socket',
                    [
                        ['demo/rooms/open', 'open'],
                        ['demo/rooms/shut', 'shut'],
                    ],
                    { open, shut },
                )

                const client = sock<string, { room: string }>('demo/rooms/open', { channel: { tail: 4 } })
                const general = client({ room: 'general' })
                const random = client({ room: 'random' })
                const upgraded = wire.connected
                general.chunks()
                random.chunks()
                await until(() => wire.connected >= upgraded + 2)

                open({ room: 'general' }).publish('hello')
                await until(() => general.chunks().length === 1)
                is('a room reaches its own subscribers', general.chunks(), ['hello'])
                is("…and nobody else's", random.chunks(), [])

                general.publish('hi')
                await until(() => general.chunks().length === 2)
                is('an allowed client publish is what the server made of it', general.chunks(), [
                    'hello',
                    'echoed: hi',
                ])

                const closed = sock<string, { room: string }>('demo/rooms/shut', { channel: { tail: 4 } })
                const quiet = closed({ room: 'general' })
                const upgradedQuiet = wire.connected
                quiet.chunks()
                await until(() => wire.connected > upgradedQuiet)
                quiet.publish('let me in')
                await sleep(10)
                is('and a socket that declared none drops it', quiet.chunks(), [])

                client.close()
                closed.close()
            },
        },

        {
            title: 'what an option can cross the wire as, and what a signal abandons',
            note: "`GET(fn, opts)` is server-side text, and an option may reference a server-only import — so the stub cannot copy one. What crosses is the CONSEQUENCE: a `ttl` arrives as a response header, in milliseconds, and the client's slot goes cold on the server's schedule. `{ signal }` abandons the AWAIT and not the load, so everyone else waiting on the same slot is unaffected.",
            async run({ is }) {
                let served = 0
                const briefly = GET(
                    ({ id }: { id: number }) => {
                        served++
                        return find(id)
                    },
                    { memo: { ttl: 20 } },
                )
                const slowly = GET(async ({ id }: { id: number }) => {
                    await sleep(20)
                    return find(id)
                })
                register(
                    'rpc',
                    [
                        ['demo/opts/briefly', 'briefly'],
                        ['demo/opts/slowly', 'slowly'],
                    ],
                    { briefly, slowly },
                )
                const remoteBriefly = client<{ id: number }, unknown>('demo/opts/briefly')
                const remoteSlowly = client<{ id: number }, { id: number; name: string }>('demo/opts/slowly')

                await remoteBriefly({ id: 1 })
                is('the client is serving what it loaded', remoteBriefly({ id: 1 }).peek(), find(1))
                await until(() => remoteBriefly({ id: 1 }).peek() === undefined)
                is("and it went cold on the server's schedule", remoteBriefly({ id: 1 }).peek(), undefined)
                is('the ttl crossed as a header, not as copied source', served, 1)

                const giveUp = new AbortController()
                const abandoned = remoteSlowly({ id: 2 }, { signal: giveUp.signal }).then(
                    () => 'resolved',
                    (error: unknown) => `abandoned: ${(error as Error).message}`,
                )
                const patient = remoteSlowly({ id: 2 })
                giveUp.abort(new Error('the user navigated away'))
                is('the abandoned await gave up', await abandoned, 'abandoned: the user navigated away')
                is('…and the load carried on for everyone else', await patient, find(2))

                const response = await remoteSlowly.raw({ id: 3 })
                is('raw() is the same call as a response', response.status, 200)
                is('…decoded by whoever asked for it', await response.json(), find(3))
            },
        },
    ],
})
