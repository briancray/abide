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
    type Failed,
    type RemoteOptions,
    type RemoteSocket,
    type RemoteSocketOptions,
    type Rpc,
    remote,
    remoteSocket,
} from 'abide'
import { ElisionError, elide, endpointId, type ImportedModule, kindOf } from 'abide/compiler'
import { config } from 'abide/server'
import {
    DELETE,
    endpoints,
    error,
    GET,
    type HttpError,
    json,
    jsonl,
    onConfig,
    POST,
    page,
    redirect,
    register,
    type Schema,
    socket,
    sse,
    validateJson,
} from 'abide/server'
import { loopback, reader, sleep, suite, until } from 'abide/tests'
import { assertType, type Exact } from '../types/exact.ts'
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
function client<Args, T, F extends Failed = never>(
    id: string,
    extra?: Omit<RemoteOptions, 'base' | 'fetch'>,
): Rpc<Args, T, F> {
    return remote<Args, T, F>(id, { base: wire.base, fetch: wire.fetch, ...extra })
}

function sock<T, Args = void>(
    id: string,
    extra?: Omit<RemoteSocketOptions, 'base' | 'open'>,
): RemoteSocket<T, Args> {
    return remoteSocket<T, Args>(id, { base: wire.base, open: wire.open, ...extra })
}

interface User {
    id: number
    name: string
}

function find(id: number): User {
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
            title: 'a read’s URL is the call — one parameter per argument',
            note: 'The URL is the public face of a read: it is what curl types, what an OpenAPI client generates, what a network panel shows and what an intermediary keys a cache on. So the args are ordinary query parameters — `?id=7&q=ada` — and a caller who never loaded the stub can make the same call by typing it. Round-tripping is the part that is not free, since a query is strings: a value JSON would read as something else travels as its JSON text, a STRING that would be misread that way travels quoted, and the DECLARED shape decides at the door, so `?name=42` on a `name: string` is the string anyone obviously meant. `__abide_args=` is the escape hatch, and it is what carries args that are not an object at all.',
            async run({ is }) {
                // The URL is the claim, so the case has to see it — `wire.fetch` counts requests but
                // does not keep them.
                const asked: string[] = []
                const watched = {
                    ...wire,
                    fetch: (input: string, init: RequestInit) => {
                        // A stub addresses the base it was built with; the hand-typed calls below
                        // are relative. Recorded as the path either way, since that is the claim.
                        asked.push(input.startsWith(wire.base) ? input.slice(wire.base.length) : input)
                        return wire.fetch(input, init)
                    },
                }
                const seen = <Args, T>(id: string) =>
                    remote<Args, T>(id, { base: watched.base, fetch: watched.fetch })

                const search = GET(
                    ({ q, page, tags }: { q: string; page: number; tags: string[] }) => ({ q, page, tags }),
                    // Declared rather than derived: a demo registers by hand, so nothing here
                    // appended the shape the compiler reads off the annotation.
                    {
                        schemas: {
                            input: {
                                type: 'object',
                                properties: {
                                    q: { type: 'string' },
                                    page: { type: 'number' },
                                    tags: { type: 'array', items: { type: 'string' } },
                                },
                            },
                        },
                    },
                )
                register('rpc', [['demo/query/search', 'search']], { search })
                const remoteSearch = seen<
                    { q: string; page: number; tags: string[] },
                    { q: string; page: number; tags: string[] }
                >('demo/query/search')

                is('the answer', await remoteSearch({ q: 'ada', page: 2, tags: ['x', 'y'] }), {
                    q: 'ada',
                    page: 2,
                    tags: ['x', 'y'],
                })
                is(
                    '…and the URL it was asked with is readable',
                    decodeURIComponent(asked[0] as string),
                    '/__abide/rpc/demo/query/search?q=ada&page=2&tags=["x","y"]',
                )

                // The point of the whole change: a caller that never loaded the stub.
                const typed = await watched.fetch(
                    '/__abide/rpc/demo/query/search?q=ada&page=2&tags=x&tags=y',
                    {},
                )
                is('a URL anyone could type reaches the same handler', await typed.json(), {
                    q: 'ada',
                    page: 2,
                    tags: ['x', 'y'],
                })
                // `?tags=x` alone is how everyone writes a list of one, and the declared shape is
                // what says it is one rather than a string.
                const single = await watched.fetch('/__abide/rpc/demo/query/search?q=ada&page=2&tags=x', {})
                is('a list of one is a list', ((await single.json()) as { tags: string[] }).tags, ['x'])

                // A query is strings, so the two ways a value could change type in flight: the shape
                // decides for a caller who typed the URL, and the quoting decides for the stub.
                const codes = GET(
                    ({ code }: { code: string }) => ({ code, isText: typeof code === 'string' }),
                    {
                        schemas: { input: { type: 'object', properties: { code: { type: 'string' } } } },
                    },
                )
                register('rpc', [['demo/query/codes', 'codes']], { codes })
                const remoteCodes = seen<{ code: string }, { code: string; isText: boolean }>(
                    'demo/query/codes',
                )

                const typedCode = await watched.fetch('/__abide/rpc/demo/query/codes?code=42', {})
                is('a declared string stays a string, however numeric it looks', await typedCode.json(), {
                    code: '42',
                    isText: true,
                })
                asked.length = 0
                is('and the stub round-trips one whatever it holds', await remoteCodes({ code: '42' }), {
                    code: '42',
                    isText: true,
                })
                is(
                    '…by quoting what would otherwise be read back as a number',
                    decodeURIComponent(asked[0] as string),
                    '/__abide/rpc/demo/query/codes?code="42"',
                )

                // The hatch: args with no name to travel under, and the door that still accepts one
                // blob — which is what an over-long read falls back to and what a multipart body
                // carries beside its files.
                const total = GET((n: number) => ({ doubled: n * 2 }))
                register('rpc', [['demo/query/total', 'total']], { total })
                asked.length = 0
                const remoteTotal = seen<number, { doubled: number }>('demo/query/total')
                is('args that are not an object', await remoteTotal(21), { doubled: 42 })
                is(
                    '…take the escape hatch, because there is no name to put them under',
                    decodeURIComponent(asked[0] as string),
                    '/__abide/rpc/demo/query/total?__abide_args=21',
                )
                const blob = await watched.fetch(
                    `/__abide/rpc/demo/query/search?__abide_args=${encodeURIComponent(
                        '{"q":"ada","page":2,"tags":["x"]}',
                    )}`,
                    {},
                )
                is('and the hatch is a door on the way in too', await blob.json(), {
                    q: 'ada',
                    page: 2,
                    tags: ['x'],
                })
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
            title: 'the origin gate compares against `APP_URL`, not against the caller’s own `Host`',
            note: 'Closed unless declared: a call carrying no `origin`, or one matching the app’s own, needs no headers; anything else has to be named by the declaration. What "the app’s own" MEANS is the point. `url.origin` comes off the request line and the `Host` header — both the caller’s — so a gate comparing an attacker’s `Origin` against an attacker’s `Host` is comparing two halves of one claim. `APP_URL` is the operator saying what the app is actually served at, which is also the only thing that makes same-origin work behind TLS termination, where `url.origin` is whatever the proxy passed through. Undeclared, it falls back to the request’s own origin, which is the weaker answer and says so.',
            async run({ is }) {
                const secret = GET(() => ({ ok: true }), { crossOrigin: ['https://named.example'] })
                register('rpc', [['demo/origin/secret', 'secret']], { secret })
                // A second origin, which is what `loopback`'s `base` is for: the app is served at
                // `https://app.example` and this wire reaches it at the address a proxy would.
                const proxied = loopback('http://internal.local')
                const ask = (origin: string): Promise<Response> =>
                    proxied.fetch('/__abide/rpc/demo/origin/secret', {
                        method: 'GET',
                        headers: { origin },
                    })

                is('undeclared, the request’s own origin is what passes', (await ask('http://internal.local')).status, 200)
                is('a foreign origin is refused', (await ask('https://evil.example')).status, 403)
                is('a declared one is allowed', (await ask('https://named.example')).status, 200)

                const off = onConfig(() => ({ APP_URL: 'https://app.example' }))
                config.invalidate()
                is('with APP_URL declared, THAT is same-origin', (await ask('https://app.example')).status, 200)
                is(
                    'and the origin the caller’s own Host claims no longer is',
                    (await ask('http://internal.local')).status,
                    403,
                )
                is('a declaration still names its own', (await ask('https://named.example')).status, 200)
                off()
                config.invalidate()
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
            title: 'a declared failure carries DATA, and the caller narrows to it',
            note: 'A name tells a caller WHICH refusal; the data tells it what to do about one. `error.typed(name, status?, message?, { schema })` declares both at once — the schema types the payload and checks it, and the message moves to the declaration because the first argument is the data now. The half that makes it reach the other side is `return myError(data)` rather than `throw`: a throw is erased from a handler’s type and a return is in it, so the declaration lands in `Rpc<Args, User, Failed<…>>` and `isError` narrows off it. The value the slot holds is the other half of that split, which is why `.data` never shows up where a caller expected a `User`.',
            async run({ is, rejects }) {
                // The zero-ceremony schema form — return what you accept, throw what you refuse —
                // which is also what gives `Data` a type without anything being written twice.
                const anAttempt = (value: unknown): { id: number; tried: number } => {
                    const { id, tried } = value as { id?: unknown; tried?: unknown }
                    if (typeof id !== 'number' || typeof tried !== 'number') {
                        throw new Error('an attempt is an id and a count')
                    }
                    return { id, tried }
                }
                const gone = error.typed('Gone', 410, 'that user was deleted', { schema: anAttempt })

                is('the status is declared once', gone.status, 410)
                is('…and so is the phrase a bare throw uses', gone.message, 'that user was deleted')

                // RETURNED, so the failure is in the handler's own type. It throws all the same.
                const getUser = GET(({ id }: { id: number }) => {
                    if (id < 0) return gone({ id, tried: 2 })
                    return find(id)
                })
                register('rpc', [['demo/data/getUser', 'getUser']], { getUser })

                // The type-level half of the claim, asserted rather than described: the value a
                // caller reads is the ANSWER with the refusals taken out, and `any` would pass an
                // assignability check where this identity one fails.
                assertType<Exact<ReturnType<ReturnType<typeof getUser>>, User | undefined>>()

                let local: unknown
                try {
                    getUser({ id: -1 })()
                } catch (failure) {
                    local = failure
                }
                is('the name answers in-process', getUser({ id: -1 }).isError(local, 'Gone'), true)
                if (getUser({ id: -1 }).isError(local, 'Gone')) {
                    // Inside the narrowing, `local` IS the failure — this line is the whole feature.
                    assertType<Exact<typeof local.data, { id: number; tried: number }>>()
                    is('…and the data is the handler’s own object', local.data, { id: -1, tried: 2 })
                    is('with the name it was declared under', local.name, 'Gone')
                    is('and the declared status on it', local.status, 410)
                }

                // A stub written by hand says what it refuses with, the same way it says what it
                // answers with. One the compiler writes says neither — the caller's checker reads
                // the handler's own declaration, which is `getUser` above.
                const remoteUser = client<
                    { id: number },
                    User,
                    Failed<'Gone', { id: number; tried: number }>
                >('demo/data/getUser')

                await rejects('the read rejects with the declared phrase', remoteUser({ id: -1 }), /deleted/)
                is('and answers the declared status', (await remoteUser.raw({ id: -1 })).status, 410)
                let carried: unknown
                try {
                    remoteUser({ id: -1 })()
                } catch (failure) {
                    carried = failure
                }
                is('the name survived the wire', remoteUser({ id: -1 }).isError(carried, 'Gone'), true)
                if (remoteUser({ id: -1 }).isError(carried, 'Gone')) {
                    assertType<Exact<typeof carried.data, { id: number; tried: number }>>()
                    is('…and so did the data', carried.data, { id: -1, tried: 2 })
                    is('and the status, which a plain rebuilt Error had nowhere to put', carried.status, 410)
                }

                // A name the endpoint never declared is still an ordinary question, answered `false`
                // rather than refused — the boolean `isError` has always been.
                is('a name it does not declare', remoteUser({ id: -1 }).isError(carried, 'Missing'), false)

                // The value half is untouched: nothing about declaring a refusal reaches the answer.
                is('and the call that succeeds answers a user', await remoteUser({ id: 3 }), find(3))
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
                    error(422, 'that is not a number')
                } catch (failure) {
                    caught = failure
                }
                is('error throws its status', (caught as HttpError).status, 422)
                is('…and a typed one throws its name', error.typed('Forbidden', 403).kind, 'Forbidden')

                // The STATUS is the argument there is no answering without, and the message is the
                // part it may already have said — so a bare `error(404)` is a whole refusal rather
                // than one with an empty body where a reader expected a reason.
                let bare: unknown
                try {
                    error(404)
                } catch (failure) {
                    bare = failure
                }
                // The registry's wording verbatim, not abide's: a caller reading this off a wire is
                // reading what the number has meant since HTTP/1.0.
                is('an unsaid message is the status’ own phrase', (bare as HttpError).message, 'Not Found')

                // A typed failure resolves its phrase at the DECLARATION, so the status is named once
                // and a bare throw of it is whole too.
                const gone = error.typed('Gone', 410)
                let expired: unknown
                try {
                    gone()
                } catch (failure) {
                    expired = failure
                }
                is('…and a typed one keeps its own name over it', (expired as HttpError).name, 'Gone')
                is('with the phrase its status declared', (expired as HttpError).message, 'Gone')
            },
        },

        {
            title: 'every response abide builds names the operation that answered it',
            note: '`traceresponse` is the W3C header a caller stitches its own span to, and it goes on through one funnel — so an answer, a refusal and the 404 for an address nobody registered all carry it. A failure is the response you most want to correlate, which is why the refusals are the point rather than the exception. The scope it is read from is opened by `dispatch` itself, so an app that mounted `dispatch` and nothing else has this already.',
            async run({ is }) {
                const parent = /^00-([\da-f]{32})-([\da-f]{16})-[\da-f]{2}$/

                const getUser = GET(({ id }: { id: number }) => find(id))
                register('rpc', [['demo/traced/getUser', 'getUser']], { getUser })

                const answered = await wire.fetch('/__abide/rpc/demo/traced/getUser?id=1', {})
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
            title: 'a declared shape is enforced at every door the call arrives through',
            note: 'A schema is checked in the memo BODY, which is the one place a wire call, an in-process call and a handler another handler reaches all end at — so there is no door that could be added later and forget to. Three forms and no dependency: JSON Schema is the NATIVE one, a plain function returns what it accepts and THROWS what it refuses, and a Standard Schema is what zod, valibot and arktype all hand over. Each RETURNS the value, so a normaliser is one too. An input that does not match is the CALLER’s fault and answers 422; an output that does not is ours and answers 500. The gate is built once, at the declaration, so declaring the shape costs what writing the same check at the top of the handler costs.',
            async run({ is, rejects }) {
                // The zero-dependency door. This is what a hand-written parse already looks like:
                // return the value you accept, throw what you refuse.
                const anId = (value: unknown): { id: number } => {
                    const id = Number((value as { id?: unknown }).id)
                    if (!Number.isInteger(id) || id <= 0) throw new Error('id must be a positive integer')
                    return { id }
                }

                // The other form, and the reason it is the one: Standard Schema is a SPEC, so abide
                // declares the interface and imports none of the libraries that implement it.
                const aName: Schema<{ name: string }> = {
                    '~standard': {
                        version: 1,
                        vendor: 'demo',
                        validate: (value: unknown) => {
                            const name = (value as { name?: unknown }).name
                            if (typeof name === 'string' && name !== '') return { value: { name } }
                            return { issues: [{ message: 'expected a non-empty string', path: ['name'] }] }
                        },
                    },
                }

                const getUser = GET(({ id }: { id: number }) => find(id), { schemas: { input: anId } })
                const rename = POST(({ name }: { name: string }) => ({ name }), {
                    schemas: { input: aName },
                })
                const wrong = GET<void, { name: string }>(
                    () => ({ nope: true }) as unknown as { name: string },
                    { schemas: { output: aName } },
                )
                const pair = GET<void, { name: string }>(
                    async function* () {
                        yield { name: 'ada' }
                        yield { name: '' }
                    },
                    { schemas: { output: aName } },
                )
                register(
                    'rpc',
                    [
                        ['demo/shape/getUser', 'getUser'],
                        ['demo/shape/rename', 'rename'],
                        ['demo/shape/wrong', 'wrong'],
                        ['demo/shape/pair', 'pair'],
                    ],
                    { getUser, rename, wrong, pair },
                )
                const remoteUser = client<{ id: number }, { id: number; name: string }>('demo/shape/getUser')
                const remoteRename = client<{ name: string }, { name: string }>('demo/shape/rename', {
                    method: 'POST',
                })
                const remoteWrong = client<void, unknown>('demo/shape/wrong')
                const remotePair = client<void, { name: string }>('demo/shape/pair', { stream: true })

                is('a call that matches is an ordinary call', await remoteUser({ id: 7 }), find(7))
                // A schema hands the handler what it returned, so declaring one is also how a call is
                // normalised — `'3'` reaches the handler as `3`.
                is(
                    '…and the handler got what the schema returned',
                    await remoteUser({ id: '3' as never }),
                    find(3),
                )

                await rejects(
                    'over the wire, a shape that does not match',
                    remoteUser({ id: -1 }),
                    /positive integer/,
                )
                is('…and it is the caller’s fault', (await remoteUser.raw({ id: -1 })).status, 422)

                // The whole claim. This caller never touched the transport, and the same declaration
                // refuses it — because the gate is in the body both of them end at.
                await rejects('in-process, the same refusal', getUser({ id: 0 }), /positive integer/)

                let caught: unknown
                try {
                    remoteUser({ id: -1 })()
                } catch (failure) {
                    caught = failure
                }
                is(
                    'the name crossed the wire with it',
                    remoteUser({ id: -1 }).isError(caught, 'AbideSchemaError'),
                    true,
                )

                is('a Standard Schema is the other door', await remoteRename({ name: 'ada' }), {
                    name: 'ada',
                })
                await rejects(
                    '…and it refuses with every issue it found',
                    remoteRename({ name: '' }),
                    /name: expected a non-empty string/,
                )

                // A handler that answered the wrong shape is not something a caller can fix by
                // calling differently, so it is not a 422.
                await rejects('an output that does not match', remoteWrong(), /output does not match/)
                is('…is OUR fault, not the caller’s', (await remoteWrong.raw()).status, 500)

                // Per CHUNK on a handler that yields: a transcript is not one value, and a shape
                // checked only at the end is one nothing on the other side was reading by then.
                const streamed: { name: string }[] = []
                let stopped: unknown
                try {
                    for await (const one of remotePair()) streamed.push(one)
                } catch (failure) {
                    stopped = failure
                }
                is('a stream is checked per chunk — the good one arrived', streamed, [{ name: 'ada' }])
                is(
                    '…and the bad one stopped it',
                    String((stopped as Error).message).includes('non-empty string'),
                    true,
                )

                // A socket's `schema` is the WIRE's door and only the wire's: the server half is
                // `channel()` unchanged, so an app publishing into its own stream is publishing a
                // value it already holds rather than sending one.
                const chat = socket<{ name: string }>({
                    channel: { tail: 4 },
                    schema: aName,
                    clientPublish: (message, _room, into) => into.publish(message),
                })
                register('socket', [['demo/shape/chat', 'chat']], { chat })
                const remoteChat = sock<{ name: string }>('demo/shape/chat', { channel: { tail: 4 } })
                const upgraded = wire.connected
                remoteChat.chunks()
                await until(() => wire.connected > upgraded)

                remoteChat.publish({ name: 'ada' })
                await until(() => remoteChat.chunks().length === 1)
                is('a client publish that matches reaches the room', remoteChat.chunks(), [{ name: 'ada' }])

                remoteChat.publish({ name: '' })
                await sleep(10)
                is('…and one that does not is dropped at the wire', remoteChat.chunks(), [{ name: 'ada' }])

                chat.publish({ nope: true } as never)
                await until(() => remoteChat.chunks().length === 2)
                is(
                    'a SERVER publish is the channel’s own, and goes through',
                    remoteChat.chunks()[1] as unknown,
                    { nope: true },
                )
                remoteChat.close()
            },
            bench: {
                kind: 'time',
                arms: (() => {
                    // In-process on both arms, so what is measured is the GATE and not a round trip.
                    // The claim is that there is nothing to measure: the gate is one closure built at
                    // the declaration, so it costs what the same check costs written by hand.
                    const check = (value: unknown): { id: number } => {
                        const id = (value as { id?: unknown }).id
                        if (typeof id !== 'number' || !Number.isInteger(id)) {
                            throw new Error('id must be an integer')
                        }
                        return { id }
                    }
                    const declared = GET(({ id }: { id: number }) => find(id), {
                        schemas: { input: check },
                    })
                    const byHand = GET((args: { id: number }) => find(check(args).id))
                    return [
                        {
                            label: 'abide — the shape declared',
                            run: () => {
                                declared.invalidate()
                                return declared({ id: 1 })()
                            },
                        },
                        {
                            label: 'vanilla — the same check at the top of the handler',
                            run: () => {
                                byHand.invalidate()
                                return byHand({ id: 1 })()
                            },
                        },
                    ]
                })(),
            },
        },

        {
            title: 'the shape IS the type, so nobody writes it twice',
            note: '`GET(({ id }: { id: number }) => …)` already says what the call takes. An author who then has to restate that in a schema is writing one fact twice and keeping the two in step by hand — so the compiler reads it off the annotation, SYNTACTICALLY, in the same pass that writes the browser stub. What that costs is reach: an IMPORTED type cannot be resolved from one file’s tokens, and it derives to nothing rather than to a guess. The whole file leans that way — a derived shape may know LESS than the type does, because under-constraining refuses nothing the handler would have accepted, while over-constraining refuses a call that was correct at a door the author never wrote.',
            run({ is }) {
                const derive = (source: string, file = USERS): unknown =>
                    elide(source, { filename: file })?.endpoints?.[0]

                is(
                    'an inline object literal is the whole declaration',
                    derive(`export const a = GET(({ id }: { id: number }) => 1)\n`),
                    {
                        name: 'a',
                        method: 'GET',
                        streams: false,
                        input: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
                    },
                )

                // `?` and `| undefined` are the same statement about a member, and JSON Schema makes
                // it by leaving the name out of `required` rather than by a keyword of its own.
                is(
                    'optional members are optional, and `| null` is a type union',
                    (
                        derive(
                            `export const a = GET(({ id, tag }: { id: number; tag?: string | null }) => 1)\n`,
                        ) as { input?: unknown } | undefined
                    )?.input,
                    {
                        type: 'object',
                        // SORTED, and deliberately: source order reads better but a checker cannot
                        // reproduce it, so the one order both derivations can agree on is the one
                        // neither of them chose.
                        properties: { id: { type: 'number' }, tag: { type: ['null', 'string'] } },
                        required: ['id'],
                    },
                )

                // A union of literals is a closed SET, which is the one form a tool definition can
                // offer as a choice rather than as prose.
                is(
                    'a union of literals is an enum',
                    (
                        derive(`export const a = GET(({ by }: { by: 'name' | 'id' }) => 1)\n`) as {
                            input?: { properties?: Record<string, unknown> }
                        }
                    )?.input?.properties?.by,
                    { type: 'string', enum: ['name', 'id'] },
                )

                is(
                    'a File is the one value in a call that is not JSON',
                    (
                        derive(`export const a = POST(({ avatar }: { avatar: File }) => 1)\n`) as {
                            input?: { properties?: Record<string, unknown> }
                        }
                    )?.input?.properties?.avatar,
                    { type: 'string', format: 'binary' },
                )

                // The published shape is the WIRE form, because that is what a machine reading the
                // document is about to send. The gate accepts the local form beside it: an in-process
                // caller never encoded one, and refusing a call the wire would have carried is the
                // one direction a derived shape may not err in.
                const when = { type: 'string', format: 'date-time' } as const
                is(
                    'a Date publishes as the string it becomes',
                    (
                        derive(`export const a = GET(({ w }: { w: Date }) => 1)\n`) as {
                            input?: { properties?: Record<string, unknown> }
                        }
                    )?.input?.properties?.w,
                    when,
                )
                is('…and the gate takes the encoded form', validateJson(when, '2026-08-07T00:00:00Z'), null)
                is('…and the real one an in-process caller has', validateJson(when, new Date()), null)
                is(
                    '…but not just any object',
                    validateJson(when, { nope: 1 })?.[0]?.message,
                    'expected string, got object',
                )

                // A local declaration is resolvable from the same file's tokens, and nesting one
                // inside another is still one file.
                is(
                    'an interface this file declares resolves',
                    (
                        derive(
                            `interface Args { id: number; who: Inner }\ninterface Inner { ok: boolean }\nexport const a = GET((args: Args) => 1)\n`,
                        ) as { input?: { properties?: Record<string, unknown> } }
                    )?.input?.properties?.who,
                    { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
                )

                // A type OPERATOR has an operand, and consuming it is the whole point: read as a bare
                // name it left the operand looking like the next MEMBER, which then failed to be one
                // and took every member after it down with it. Under-constrained, so it refused no
                // correct call — but a published shape missing a required argument is one a machine
                // reading it generates a broken call from, which is the cost that is not safe.
                is(
                    'a type operator does not truncate the members after it',
                    (
                        derive(`export const a = GET(({ k, id }: { k: keyof Book; id: number }) => 1)\n`) as {
                            input?: { required?: string[] }
                        }
                    )?.input?.required,
                    ['k', 'id'],
                )
                is(
                    '…and `readonly` is the array it qualifies',
                    (
                        derive(`export const a = GET(({ tags }: { tags: readonly string[] }) => 1)\n`) as {
                            input?: { properties?: Record<string, unknown> }
                        }
                    )?.input?.properties?.tags,
                    { type: 'array', items: { type: 'string' } },
                )

                is(
                    'an interface INHERITS what it extends',
                    (
                        derive(
                            `interface Base { base: string }\ninterface Args extends Base { id: number }\nexport const a = GET((x: Args) => 1)\n`,
                        ) as { input?: { required?: string[] } }
                    )?.input?.required,
                    ['base', 'id'],
                )

                // An imported type is a FILESYSTEM question, not a type-checker one — `Book` below is
                // a plain interface, and the only thing missing from one file's tokens is the other
                // file's text. So `elide` takes a resolver instead of reaching for one: it still does
                // no I/O, which is what keeps this case runnable in a browser card, and the Bun plugin
                // is where the reading lives. Shapes reach the SERVER lane only, so the browser build
                // does none of the reads.
                const MODULES: Record<string, string> = {
                    '/app/server/models.ts':
                        `import type { Author } from './people.ts'\n` +
                        `export interface Book { title: string; author: Author }\n`,
                    '/app/server/people.ts': `export interface Author { name: string }\n`,
                }
                const resolve = (specifier: string, importer: string): ImportedModule | null => {
                    const parts = importer.slice(0, importer.lastIndexOf('/')).split('/').filter(Boolean)
                    for (const step of specifier.split('/')) {
                        if (step === '' || step === '.') continue
                        if (step === '..') parts.pop()
                        else parts.push(step)
                    }
                    const path = `/${parts.join('/')}`
                    const text = MODULES[path]
                    return text === undefined ? null : { path, text }
                }
                const crossing = `import type { Book } from '../models.ts'\nexport const a = GET((v: Book) => 1)\n`

                is(
                    'an imported type resolves, and so does the one IT imports',
                    (elide(crossing, { filename: USERS, resolve })?.endpoints?.[0] as { input?: unknown })
                        ?.input,
                    {
                        type: 'object',
                        properties: {
                            title: { type: 'string' },
                            author: {
                                type: 'object',
                                properties: { name: { type: 'string' } },
                                required: ['name'],
                            },
                        },
                        required: ['title', 'author'],
                    },
                )
                is(
                    '…and with no resolver the same file derives nothing rather than a guess',
                    derive(crossing),
                    { name: 'a', method: 'GET', streams: false },
                )
                is(
                    'a type from a module that does not resolve is the same answer',
                    (
                        elide(`import type { X } from '../nope.ts'\nexport const a = GET((v: X) => 1)\n`, {
                            filename: USERS,
                            resolve,
                        })?.endpoints?.[0] as { input?: unknown }
                    )?.input,
                    undefined,
                )
                // A `Map` and a `Set` do not survive `JSON.stringify` — both come out `{}` — so a
                // shape saying "object" or "array" would publish that breakage as a contract AND
                // refuse the in-process caller who passed the real thing. Nothing known is honest.
                is(
                    'a type that cannot cross derives nothing either',
                    (
                        derive(`export const a = GET(({ t }: { t: Set<string> }) => 1)\n`) as {
                            input?: { properties?: Record<string, unknown> }
                        }
                    )?.input?.properties?.t,
                    {},
                )
                is(
                    '…and so does a handler with no annotation at all',
                    derive(`export const a = GET((args) => 1)\n`),
                    { name: 'a', method: 'GET', streams: false },
                )

                // The two places a declaration can say BOTH directions.
                is(
                    'explicit type arguments say input and output',
                    derive(`export const a = GET<{ id: number }, { name: string }>(() => 1)\n`),
                    {
                        name: 'a',
                        method: 'GET',
                        streams: false,
                        input: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
                        output: {
                            type: 'object',
                            properties: { name: { type: 'string' } },
                            required: ['name'],
                        },
                    },
                )
                // A stream's type argument is its CHUNK, which is exactly what an output schema
                // checks — a transcript is not one value, and neither is the shape of one.
                is(
                    'a handler that yields publishes its CHUNK',
                    (
                        derive(
                            `export const a = GET(async function* ({ n }: { n: number }): AsyncGenerator<number> { yield n })\n`,
                        ) as { output?: unknown; streams?: boolean }
                    )?.output,
                    { type: 'number' },
                )
                // `>>` is one token to a scanner, and the extra close belongs to the list above.
                is(
                    'a nested generic closes correctly',
                    (
                        derive(`export const a = GET(({ rows }: { rows: Array<Array<number>> }) => 1)\n`) as {
                            input?: { properties?: Record<string, unknown> }
                        }
                    )?.input?.properties?.rows,
                    { type: 'array', items: { type: 'array', items: { type: 'number' } } },
                )

                // The server lane is what CARRIES it: the browser gets the address and its own types
                // already, so a schema in the stub would be bytes that answer nothing.
                const both = `export const getUser = GET(({ id }: { id: number }) => 1)\n`
                is(
                    'the server registration carries the shape',
                    elide(both, { filename: USERS })?.code.includes('"input":{"type":"object"'),
                    true,
                )
                is(
                    '…and the browser stub does not',
                    elide(both, { filename: USERS, browser: true })?.code.includes('input'),
                    false,
                )
            },
        },

        {
            title: 'a file is an argument, not a second calling convention',
            note: 'A `File` in the args is the whole declaration. There is no upload endpoint, no separate body type and no second vocabulary: the client notices the args hold something JSON cannot carry and sends multipart, with the JSON keeping a REFERENCE where the file sat — so the handler is handed the same one args object, with the file back in the place the caller put it. A READ takes that door too, for the same reason an over-long read already does: what has no text form cannot travel in a URL. And a file is keyed by IDENTITY, because two files with the same name and length are not the same file and reading them to find out is not something building a cache key may do.',
            async run({ is }) {
                const upload = POST(async ({ id, avatar }: { id: number; avatar: File }) => ({
                    id,
                    name: avatar.name,
                    // The essence, not the whole header: Bun's multipart PARSER discards the part's
                    // declared `Content-Type` and re-infers from the filename, so what comes back is
                    // `text/plain;charset=utf-8` for a `.txt` whatever was sent. The claim a
                    // multipart round trip can still make is that a File arrived with its name and
                    // its bytes; the declared type does not survive the decode.
                    type: avatar.type.split(';')[0],
                    text: await avatar.text(),
                }))
                // A READ that carries files, and more than one of them — the reference is written
                // where the file SAT, so an array of them comes back as an array.
                const gallery = GET(async ({ shots }: { shots: File[] }) => ({
                    count: shots.length,
                    texts: await Promise.all(shots.map((shot) => shot.text())),
                }))
                register(
                    'rpc',
                    [
                        ['demo/files/upload', 'upload'],
                        ['demo/files/gallery', 'gallery'],
                    ],
                    { upload, gallery },
                )
                const remoteUpload = client<{ id: number; avatar: File }, Record<string, unknown>>(
                    'demo/files/upload',
                    { method: 'POST' },
                )
                const remoteGallery = client<{ shots: File[] }, Record<string, unknown>>('demo/files/gallery')

                const avatar = new File(['hello bytes'], 'a.txt', { type: 'text/plain' })
                is('a mutation carries the file', await remoteUpload({ id: 1, avatar }), {
                    id: 1,
                    name: 'a.txt',
                    type: 'text/plain',
                    text: 'hello bytes',
                })

                is(
                    'a READ carries files too, in a body it could not have put in a URL',
                    await remoteGallery({ shots: [new File(['one'], '1.txt'), new File(['two'], '2.txt')] }),
                    { count: 2, texts: ['one', 'two'] },
                )

                // Same key by VALUE, different by identity. Without that the second upload is
                // answered with the first one's result, which is the whole hazard.
                const first = await remoteUpload({ id: 2, avatar: new File(['AAA'], 'x.txt') })
                const second = await remoteUpload({ id: 2, avatar: new File(['BBB'], 'x.txt') })
                is('two different files are two slots', [first.text, second.text], ['AAA', 'BBB'])

                // The handler never learns which door the call arrived through.
                is('in-process, the same call with no wire at all', await upload({ id: 3, avatar }), {
                    id: 3,
                    name: 'a.txt',
                    type: 'text/plain',
                    text: 'hello bytes',
                })
            },
        },

        {
            title: 'every endpoint publishes the shape a machine reads before calling it',
            note: 'This is what the shape story is FOR. Standard Schema is validate-only — it hands over a `validate` function and nothing that says what the shape IS — so a schema declared through one cannot become a tool definition or an OpenAPI operation. That is why JSON Schema is what a declaration MEANS rather than something abide converts to on the way out: an MCP tool is `{ name: id, description, inputSchema: input }` and an OpenAPI operation is the same three facts under other names, so neither needs a generator in here. `endpoints()` answers in-process and `GET /__abide/schema` answers over the wire — open, because every address in it is already in the client bundle and the shape beside it is the contract for calling one.',
            async run({ is }) {
                const search = GET(({ q, page }: { q: string; page?: number }) => ({ q, page: page ?? 1 }), {
                    description: 'Search the catalogue',
                })
                register(
                    'rpc',
                    [['demo/catalogue/search', 'search']],
                    { search },
                    {
                        // What the compiler appends for a real module. Written out here because a demo
                        // registers a declaration it built itself — the seam is the same either way.
                        search: {
                            input: {
                                type: 'object',
                                properties: { q: { type: 'string' }, page: { type: 'number' } },
                                required: ['q'],
                            },
                        },
                    },
                )

                const published = endpoints().filter((one) => one.id.startsWith('demo/catalogue/'))
                is('the catalogue carries the address, the method and the shape', published, [
                    {
                        id: 'demo/catalogue/search',
                        kind: 'rpc',
                        method: 'GET',
                        description: 'Search the catalogue',
                        input: {
                            type: 'object',
                            properties: { q: { type: 'string' }, page: { type: 'number' } },
                            required: ['q'],
                        },
                    },
                ])

                // An MCP tool list is this map and nothing else, which is the claim.
                const tools = published.map((one) => ({
                    name: one.id,
                    description: one.description,
                    inputSchema: one.input,
                }))
                is('an MCP tool definition is one map away', tools[0]?.name, 'demo/catalogue/search')
                is('…with the input schema as its inputSchema', tools[0]?.inputSchema, published[0]?.input)

                // And it is enforced, because the derivation is not decoration: a shape nobody wrote
                // still refuses the call that does not match it.
                is('the derived shape is the one that is checked', await search({ q: 'ok' }), {
                    q: 'ok',
                    page: 1,
                })
                let refused: unknown
                try {
                    search({ q: 7 as never })()
                } catch (failure) {
                    refused = failure
                }
                is(
                    'a call that does not match it is refused',
                    /q: expected string/.test(String((refused as Error)?.message)),
                    true,
                )

                const served = await wire.fetch('/__abide/schema', {})
                const document = (await served.json()) as { id: string }[]
                is('the same document over the wire', served.status, 200)
                is(
                    '…listing the same endpoint',
                    document.some((one) => one.id === 'demo/catalogue/search'),
                    true,
                )
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
                // The same answer `kindOf` gives, carried on the result: a caller that already
                // elided a module does not have to ask the path a second time, and the two cannot
                // disagree because `elide` reads it from `kindOf` on the way in.
                is('the result carries its kind', server?.kind, 'rpc')
                is('…the same one on both lanes', browser?.kind, 'rpc')
                is('and a file under neither elides to nothing at all', elide(source, { filename: '/app/db.ts' }), null)
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
                    // The socket's first type argument is its MESSAGE, which is the one place a
                    // channel can say what it carries — so the shape comes along with the address.
                    [{ name: 'ticks', method: 'socket', streams: false, input: { type: 'number' } }],
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
            note: 'A socket splits into rooms the way a channel does — the CALL selects one — and the room travels in the address, so the subscribe on the server is `ch(args).subscribe(…)` and nothing else. `clientPublish` is a POLICY: a socket is a broadcast until an app says otherwise, because a client that may publish into a room may write to every subscriber of it. It is handed `(message, room, into)`, where `into` is the room the sender is on, already resolved — an echo publishes there rather than re-selecting it by name.',
            async run({ is }) {
                // The policy is handed the room it is publishing into — the same channel the sender
                // is subscribed to — so it never names the declaration it is inside.
                const open = socket<string, { room: string }>({
                    channel: { tail: 4 },
                    clientPublish: (message, _room, into) => {
                        into.publish(`echoed: ${String(message)}`)
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
