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
// `packages/dogfood/src/tests/unit/transport.test.ts`, which spawns a lane with no DOM emulator in it.
//
// Nor can it show what rides the REQUEST SCOPE — `traceresponse` on what dispatch answers, and the
// ambients beside it. Bun bundles `node:async_hooks` for a browser as an empty object, so a card
// dispatching to itself is serving with no scope open at all: those claims are in `#tests/unit/serve.test.ts`
// for the same reason a claim that needs a click is in `interact`.
//
// This page imports `abide/compiler` for the elision case, and therefore ships TypeScript's scanner.
// That is deliberate: the claim a reader comes here for is "the browser gets the address and not the
// body", and moving it to another page to save a page nobody profiles would be hiding it.

import { channel, type Failed, html } from 'abide'
// The two stubs the elider writes and the shapes that describe them, called directly here because
// this suite is what tests them.
import {
    type CallOptions,
    type RemoteOptions,
    remote,
    type RemoteSocket,
    type RemoteSocketOptions,
    remoteSocket,
    type Rpc,
    type Wire,
} from 'abide/runtime/transport'
import { ElisionError, elide, endpointId, type ImportedModule, kindOf, type TypeSource } from 'abide/compiler'
import {
    config,
    DELETE,
    error,
    GET,
    type HttpError,
    json,
    jsonl,
    type JsonSchema,
    onConfig,
    POST,
    page,
    redirect,
    type Schema,
    type SchemaRefusal,
    type StandardSchemaV1,
    socket,
    sse,
} from 'abide/server'
import {
    endpoints,
    openapi,
    register,
    renderToString,
    SCHEMA_ERROR,
    validateJson,
} from 'abide/server/internal'
import { loopback, reader, sleep, suite, until } from 'harness'
import { countCalls, duration, nsPerOp, tick } from 'harness/measure'
import { hydrate } from 'abide/ui'
import { assertType, type Exact } from '#tests/types/exact.ts'
import { button, el, field, row, stage } from './dom.ts'
import { META } from './SUITES.ts'
import * as vanilla from './vanilla.ts'

const USERS = '/app/server/rpc/users.ts'
const AUDIT = '/app/server/rpc/admin/audit.ts'
const FEED = '/app/server/sockets/feed.ts'

/** A keyed socket's room, as the three cases below declare it. The shape is the case's WIRING. */
const ROOM_BY_NAME: JsonSchema = {
    type: 'object',
    properties: { room: { type: 'string' } },
    required: ['room'],
}

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
            note: "Both halves of the law return the SAME THING — a keyed memo — so the caller's whole vocabulary is already written and identical on both sides. The CALL selects a slot and starts nothing; ASKING is what reaches the server, and a probe is an ask — `{#if remoteUser({ id }).pending()}` is a page saying it will show this, so the fetch is in flight by the time the arm is chosen. `peek` is what still answers on a cold key without causing a request.",
            async run({ is }) {
                const getUser = GET(({ id }: { id: number }) => find(id))
                register('rpc', [['demo/read/getUser', 'getUser']], { getUser })
                const remoteUser = client<{ id: number }, { id: number; name: string }>('demo/read/getUser')

                is('selecting a slot starts nothing — peek()', remoteUser({ id: 7 }).peek(), undefined)
                is('…and pending() KICKS the fetch it reports', remoteUser({ id: 7 }).pending(), true)

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
                const shown = el('p', 'text-lg text-ink min-h-7')
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

                is(
                    'undeclared, the request’s own origin is what passes',
                    (await ask('http://internal.local')).status,
                    200,
                )
                is('a foreign origin is refused', (await ask('https://evil.example')).status, 403)
                is('a declared one is allowed', (await ask('https://named.example')).status, 200)

                const off = onConfig(() => ({ APP_URL: 'https://app.example' }))
                config.invalidate()
                is(
                    'with APP_URL declared, THAT is same-origin',
                    (await ask('https://app.example')).status,
                    200,
                )
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
            note: "A failed load throws from the READ, which is the state's rule already — so a transport failure needs no error path of its own. What the transport does have to carry is the NAME: an error that crossed a wire arrives as a plain object, so `instanceof` on it is false however faithfully it was serialised, and `isError(e, name)` is the question that outlives the constructor.",
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
                // assignability check where this identity one fails. No `| undefined` for the load
                // still being in flight — a read that cannot answer yet signals instead.
                assertType<Exact<ReturnType<ReturnType<typeof getUser>>, User>>()

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
                //
                // The REJECTION is the claim and the message is not: reading a body whose stream
                // errors gives the source's error under bun and a bare `TypeError: Failed to fetch`
                // in a browser, which is what a truncated response looks like from the outside. This
                // asserted `/gave up/` and was red on `/tests/transport` in every browser.
                async function* stops(): AsyncGenerator<number> {
                    yield 1
                    throw new Error('the source gave up')
                }
                await rejects('a source that throws mid-stream', jsonl(stops()).text())

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
            title: 'a handler that yields is a stream on both sides',
            note: 'A generator declaration is recognised from the function itself, so the browser lane knows to read the response as chunks without a type-checker. The state does the rest: it holds the LATEST chunk, `chunks()` holds the transcript, and a second consumer replays what already arrived before following what comes next.',
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
                const shown = el('p', 'text-3xl font-semibold text-ink tabular-nums', '—')
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
            title: 'an argument nothing REQUIRES may be left off the call',
            note: 'The args slot is the cache key, so it was mandatory whatever the handler declared — `catalogue({})` on an endpoint with no parameter at all, and the same `{}` on one whose every field has a default. `Selecting<Args>` makes the position optional exactly when `{}` satisfies `Args`, which covers both and leaves a required field required. An OMITTED argument is `{}` and not `undefined`: it keys the slot `f({})` keys, it travels as the query `f({})` travels, and a handler destructuring its parameter is handed something to destructure. Read off the ARITY rather than coalesced with `??`, because `Args` of `void` is a read whose argument really is `undefined` and whose address is the bare one — coalescing put `?$args=%7B%7D` on every such URL, which the address case below is what caught.',
            async run({ is }) {
                const catalogue = GET(() => ['ada', 'grace'])
                const paged = GET(({ page = 1, size = 20 }: { page?: number; size?: number }) => ({
                    page,
                    size,
                }))

                is('a handler with no parameter takes no argument', await catalogue(), ['ada', 'grace'])
                is('…and it is the slot the empty call selects', catalogue() === catalogue({}), true)

                // The defaults are the point: they only apply because the omission arrived as `{}`.
                // Handed `undefined`, the destructure in the handler throws before any of them run.
                is('every field defaulted is nothing required', await paged(), { page: 1, size: 20 })
                is('…and one given still wins', await paged({ page: 2 }), { page: 2, size: 20 })

                // The half that must NOT move — see the address case below for the URL this broke.
                const counted = client<void, number>('demo/optional/count')
                is(
                    'a void-args read keeps its bare address',
                    counted.url(undefined),
                    `${wire.base}/__abide/rpc/demo/optional/count`,
                )

                // A required field is still required, and that is a claim about the TYPE: the runtime
                // cannot tell an omission from a call the checker should have refused. `#tests/types`
                // carries the negative half — `one()` on `({ id }: { id: number })` must not compile.
                const one = GET(({ id }: { id: number }) => id)
                assertType<Exact<Parameters<typeof one>, [args: { id: number }]>>()
                assertType<Exact<Parameters<typeof paged>, [args?: { page?: number; size?: number }]>>()

                // The options are still reachable past an argument that may be left off, which the
                // variadic form is what preserves — `[...Selecting<Args>, options?: CallOptions]`.
                const options: CallOptions = { signal: AbortSignal.timeout(500) }
                is('…and a call may still carry its options', await paged({ page: 3 }, options), {
                    page: 3,
                    size: 20,
                })
            },
        },

        {
            title: 'every call has an ADDRESS, for the callers that need one instead of a fetch',
            note: '`raw` makes the call; `url` says where it would go. What needs the second is anything that is not a `fetch` — an `EventSource` over a handler framed with `sse()`, which is the browser’s own client for that framing and knows nothing about abide, a `<form method="post" action>` posted straight at an endpoint, plus the `curl` line in a bug report. Built through the SAME expression `ask` addresses with, so a server’s answer about where a call goes cannot drift from where a client sent it — and mounted, so it survives a sub-path the way every other address abide writes does. A MUTATION answers with its bare address and ignores what it was handed, because its arguments are in the body: that address is where the call goes whatever they say, it is the one `openapi.json` publishes for the endpoint, and it is what the form door leaves no other public spelling for. The refusals are the READ’s, where the args ARE the address: a file has no text form and a long enough query does not fit, so both travel in a body and the bare address would be a URL missing its arguments — a 404 at a plausible-looking path.',
            run({ is, throws }) {
                const search = client<{ q: string }, string[]>('demo/address/search')
                is(
                    'a read is its address plus its args',
                    search.url({ q: 'ada' }),
                    `${wire.base}/__abide/rpc/demo/address/search?q=ada`,
                )
                is(
                    'and with no args, just the address',
                    client<void, number>('demo/address/count').url(undefined),
                    `${wire.base}/__abide/rpc/demo/address/count`,
                )

                // A mutation's args are in the body, so the address is the same one whatever it is
                // handed — which is exactly what a `<form action>` needs and what the same endpoint
                // is published at in `openapi.json`.
                const rename = client<{ id: number }, void>('demo/address/rename', { method: 'POST' })
                is(
                    'a mutation is its bare address, because its args are in the body',
                    rename.url({ id: 1 }),
                    `${wire.base}/__abide/rpc/demo/address/rename`,
                )
                is('…and the args make no difference to it', rename.url({ id: 2 }), rename.url({ id: 1 }))

                // The read's own two doors, where the args ARE the address and travelling in a body
                // leaves none to hand back.
                throws(
                    'a read too long for a URL has none',
                    () => search.url({ q: 'x'.repeat(3000) }),
                    /past the \d+ a URL may carry/,
                )
                throws(
                    '…and neither does a read carrying a file',
                    () =>
                        client<{ page: File }, void>('demo/address/attach').url({
                            page: new File(['x'], 'x.txt'),
                        }),
                    /carrying a file/,
                )
            },
        },

        {
            title: 'a FRAMED body is chunks too, and the content type is the whole of what decides',
            note: 'The two framing helpers answer with a sequence exactly as a generator does — the only difference is that the address is one anything can read, `jsonl()` for a line-delimited body and `sse()` for an event stream. So the reader is the same reader: `isChunked` asks the response what it is rather than trusting what the stub was told, and one decoder walks all three framings because an event stream is line-delimited too. What differs is which lines carry a value — an `sse` body’s `event:`, `id:` and keep-alive comment lines carry none, and `data: ` comes off the front of the ones that do. Before this only the wire’s own ndjson was seen as chunks, so a `jsonl()` or `sse()` body decoded as one blob of text and reading either meant a `getReader()` and a `TextDecoder` in the page.',
            async run({ is }) {
                async function* items(): AsyncGenerator<{ id: number }> {
                    for (let id = 1; id <= 3; id++) yield { id }
                }
                const lines = GET(() => jsonl(items()))
                const events = GET(() => sse(items()))
                // The TYPE half of the same claim, and it needs saying separately: a `Response` says
                // nothing about its own body, so before `Framed<T>` both of these declared `Response`
                // and the loops below had no element type to be — green `tsc`, useless caller.
                assertType<Exact<ReturnType<ReturnType<typeof lines>>, { id: number }>>()
                assertType<Exact<ReturnType<ReturnType<typeof events>>, { id: number }>>()
                register(
                    'rpc',
                    [
                        ['demo/framed/lines', 'lines'],
                        ['demo/framed/events', 'events'],
                    ],
                    { lines, events },
                )
                const remoteLines = client<Record<string, never>, { id: number }>('demo/framed/lines', {
                    stream: true,
                })
                const remoteEvents = client<Record<string, never>, { id: number }>('demo/framed/events', {
                    stream: true,
                })

                const framed: { id: number }[] = []
                for await (const item of remoteLines({})) framed.push(item)
                is('a jsonl body arrives as its VALUES', framed, [{ id: 1 }, { id: 2 }, { id: 3 }])

                const evented: { id: number }[] = []
                for await (const item of remoteEvents({})) evented.push(item)
                is('an sse body as the same ones, unframed', evented, [{ id: 1 }, { id: 2 }, { id: 3 }])

                // The rest of the slot's vocabulary follows for free, because it is the vocabulary a
                // keyed memo already had — which is the whole claim of `rpc = memo + transport`.
                is('chunks() is the transcript either way', remoteEvents({}).chunks(), [
                    { id: 1 },
                    { id: 2 },
                    { id: 3 },
                ])
                is('and the read is the LATEST chunk', remoteEvents({})(), { id: 3 })
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
            title: 'the LENGTH of a chunk never reaches the reader that finds its end',
            note: 'The wire is line-delimited, so the reader searches each read for a newline. A chunk larger than a read spans many of them, and the reader that appended each read to one buffer re-searched what it had already proved newline-free — quadratic in the length of one chunk. Searching each read WHERE IT ARRIVES fixes the scan, and holding the pieces in an array rather than one growing string fixes what a scan cursor cannot: `held += piece` builds a cons string, and the `indexOf` after it flattens the whole buffer on every read. That last part is V8’s and not JSC’s, so this case is the reason the suite pages are a browser gate — 512 KiB read 18.8x the 128 KiB one in chromium while `bun test` read 3.2x for the same code, and the ratio here is 3.6x in a browser now.',
            async run({ is, log }) {
                // A ratio between two sizes of the SAME structure, which is the only timing claim
                // that survives moving between substrates: one chunk, delivered in reads far smaller
                // than it, at two lengths 4x apart. Linear costs ~4x; re-reading the buffer ~16x.
                // Reads far smaller than the chunk are what make the waste visible rather than
                // merely present: it is quadratic in reads-per-chunk, so 1 KiB reads separate the two
                // implementations where 4 KiB reads leave them 6.4x apart — inside a bound loose
                // enough to survive a browser card's clock.
                //
                // And it is the CARD that this case is for. Headless it passes either way, because
                // the cost it is about is V8's — so a green `bun test` here means nothing at all, and
                // the row on /tests/transport is where the assertion bites.
                const READ = 1024
                const streamOf = (length: number) => {
                    const line = `${JSON.stringify('x'.repeat(length))}\n`
                    const bytes = new TextEncoder().encode(line)
                    return () =>
                        new Response(
                            new ReadableStream<Uint8Array>({
                                start(controller) {
                                    for (let at = 0; at < bytes.length; at += READ) {
                                        controller.enqueue(bytes.subarray(at, at + READ))
                                    }
                                    controller.close()
                                },
                            }),
                            { headers: { 'content-type': 'application/x-ndjson' } },
                        )
                }
                const drain = async (make: () => Response): Promise<void> => {
                    const one = remote<Record<string, never>, string>('demo/stream/long', {
                        base: 'http://sizes.test',
                        fetch: async () => make(),
                        stream: true,
                    })
                    for await (const _ of one({})) {
                        // The chunks themselves are not the claim; reaching the end of them is.
                    }
                }

                const short = streamOf(128 * 1024)
                const long = streamOf(512 * 1024)
                const [cheap, dear] = (await nsPerOp([
                    { label: '128 KiB in one chunk', run: () => drain(short) },
                    { label: '512 KiB in one chunk', run: () => drain(long) },
                ])) as [number, number]

                const ratio = dear / cheap
                log('per stream', `128 KiB — ${duration(cheap)}, 512 KiB — ${duration(dear)}`)
                // Loose, because everything else in the drain is linear too and a card's clock is
                // noisy. What it has to separate is the ~4x of a cursor from the ~16x of a re-scan.
                is(`4x the chunk costs about 4x, not 16x (${ratio.toFixed(1)}x)`, ratio < 8, true)
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
                // Typed as `StandardSchemaV1` rather than only as `Schema`: the interop interface is
                // what abide DECLARES and never imports, so naming it here is what proves a real
                // library's schema would structurally match — and makes a drift in the declared
                // shape a failure in the dogfood rather than at somebody's `zod` call site.
                const aName: StandardSchemaV1<{ name: string }> = {
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
                // …and one of the three forms `Schema` accepts, which is the claim the union makes:
                // a library's own object goes into the same option a plain function or a JsonSchema
                // does, with no adapter between them.
                const asOption: Schema<{ name: string }> = aName

                const getUser = GET(({ id }: { id: number }) => find(id), { schemas: { input: anId } })
                const rename = POST(({ name }: { name: string }) => ({ name }), {
                    schemas: { input: asOption },
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
                    // `SCHEMA_ERROR` rather than the string: one name for the one thing a refusal
                    // travels under, so a rename cannot leave this assertion quietly passing.
                    remoteUser({ id: -1 }).isError(caught, SCHEMA_ERROR),
                    true,
                )
                // …and so did the issues, as the DATA rather than as a sentence to parse. The
                // narrowing comes off `getUser` because that is the declaration: every one of them
                // refuses this way, since a shape nobody wrote is still the one the compiler derived
                // from the handler's type, so nothing here was declared to make the line below type.
                if (getUser({ id: 0 }).isError(caught, SCHEMA_ERROR)) {
                    assertType<Exact<typeof caught.data, SchemaRefusal['data']>>()
                    is('…and every issue it found came with it', caught.data, [
                        { path: '', message: 'id must be a positive integer' },
                    ])
                }

                is('a Standard Schema is the other door', await remoteRename({ name: 'ada' }), {
                    name: 'ada',
                })
                await rejects(
                    '…and it refuses with every issue it found',
                    remoteRename({ name: '' }),
                    /name: expected a non-empty string/,
                )
                let refusedName: unknown
                try {
                    rename({ name: '' })()
                } catch (failure) {
                    refusedName = failure
                }
                // The PATH is the reason this is data at all: a form putting the refusal beside the
                // field that caused it has the field name here, rather than by splitting the message
                // on a `: ` this file would then have to keep spelling the same way.
                if (rename({ name: '' }).isError(refusedName, SCHEMA_ERROR)) {
                    is('…each with the path that names the field', refusedName.data, [
                        { path: 'name', message: 'expected a non-empty string' },
                    ])
                }

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
                const held = remoteChat()
                const upgraded = wire.connected
                held.chunks()
                await until(() => wire.connected > upgraded)

                held.publish({ name: 'ada' })
                await until(() => held.chunks().length === 1)
                is('a client publish that matches reaches the room', held.chunks(), [{ name: 'ada' }])

                held.publish({ name: '' })
                await sleep(10)
                is('…and one that does not is dropped at the wire', held.chunks(), [{ name: 'ada' }])

                chat().publish({ nope: true } as never)
                await until(() => held.chunks().length === 2)
                is('a SERVER publish is the channel’s own, and goes through', held.chunks()[1] as unknown, {
                    nope: true,
                })
                remoteChat.close()
            },
            bench: {
                kind: 'time',
                arms: (() => {
                    // In-process on both arms, so what is measured is the GATE and not a round trip.
                    // The claim is that there is nothing to measure: the gate is one closure built at
                    // the declaration, so it costs what the same check costs written by hand.
                    //
                    // NOT a vanilla arm in the sense the rest of the benches mean it — both sides are
                    // abide, exactly as `compiler.ts`'s unsugared arm is. Labelled `abide` on purpose:
                    // `rows.ts` promotes the first arm whose label starts with `vanilla` into the
                    // card's hand-written comparator, so the old label had the page reporting a ratio
                    // against hand-written code for a second `GET`.
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
                            label: 'abide — the same check at the top of the handler',
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
                    // Every field of a derived shape is WRITTEN, `undefined` included — the schema
                    // walk builds one hidden class per kind rather than growing one per fact it
                    // happened to learn. `JSON.stringify` drops an undefined value, so the published
                    // document carries only what is known; this is the in-memory form.
                    {
                        name: 'a',
                        method: 'GET',
                        asDefault: false,
                        streams: false,
                        input: {
                            type: 'object',
                            properties: { id: { type: 'number' } },
                            required: ['id'],
                            additionalProperties: undefined,
                        },
                        output: undefined,
                        room: undefined,
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
                        additionalProperties: undefined,
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
                    {
                        type: 'object',
                        properties: { ok: { type: 'boolean' } },
                        required: ['ok'],
                        additionalProperties: undefined,
                    },
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
                // Annotated as `TypeSource` rather than left to infer: it is the seam `elide` takes
                // so a shape declared in ANOTHER file still publishes, and naming the type here is
                // what makes a change to that signature a failure in the dogfood rather than in
                // whatever build first passed the old shape.
                const resolve: TypeSource = (specifier, importer) => {
                    const parts = importer.slice(0, importer.lastIndexOf('/')).split('/').filter(Boolean)
                    for (const step of specifier.split('/')) {
                        if (step === '' || step === '.') continue
                        if (step === '..') parts.pop()
                        else parts.push(step)
                    }
                    const path = `/${parts.join('/')}`
                    const text = MODULES[path]
                    if (text === undefined) return null
                    // The answer named too: `TypeSource` says what the seam IS, `ImportedModule` what
                    // one hop across it carries, and both are public — so both are spelled here.
                    const found: ImportedModule = { path, text }
                    return found
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
                                additionalProperties: undefined,
                            },
                        },
                        required: ['title', 'author'],
                        additionalProperties: undefined,
                    },
                )
                is(
                    '…and with no resolver the same file derives nothing rather than a guess',
                    derive(crossing),
                    {
                        name: 'a',
                        method: 'GET',
                        asDefault: false,
                        streams: false,
                        input: undefined,
                        output: undefined,
                        room: undefined,
                    },
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
                    {
                        name: 'a',
                        method: 'GET',
                        asDefault: false,
                        streams: false,
                        input: undefined,
                        output: undefined,
                        room: undefined,
                    },
                )

                // The two places a declaration can say BOTH directions.
                is(
                    'explicit type arguments say input and output',
                    derive(`export const a = GET<{ id: number }, { name: string }>(() => 1)\n`),
                    {
                        name: 'a',
                        method: 'GET',
                        asDefault: false,
                        streams: false,
                        input: {
                            type: 'object',
                            properties: { id: { type: 'number' } },
                            required: ['id'],
                            additionalProperties: undefined,
                        },
                        output: {
                            type: 'object',
                            properties: { name: { type: 'string' } },
                            required: ['name'],
                            additionalProperties: undefined,
                        },
                        room: undefined,
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
            title: 'a form anyone could post is a call, exactly as a URL anyone could type is',
            note: "The form door is not the stub's private encoding. A form built anywhere — `new FormData(element)` out of a page, a `<form method=\"post\">` with no `enctype`, a `curl -F`, some other language's http client — is read ONE ENTRY PER ARGUMENT by the same reader the query goes through, so the same declared shape turns `age=36` into a number, the same repeated name is a list, and a file input lands on a declared `File`. Multipart and urlencoded are one door, because `Request.formData()` reads both into the same entries and only the first can hold a file. What tells the stub's encoding apart is the presence of the `__abide_args` part, which only the encoder writes: with it, the JSON is the args and the other parts are its files; without it, the entries ARE the args. So an endpoint takes a form post and a stub call with nothing declared per door and no second handler.",
            async run({ is }) {
                const enrol = POST(
                    async ({
                        name,
                        age,
                        tags,
                        avatar,
                    }: {
                        name: string
                        age: number
                        tags: string[]
                        // Optional because only a MULTIPART form can carry one, and the urlencoded
                        // call below is the same endpoint through the other spelling.
                        avatar?: File
                    }) => ({
                        name,
                        age,
                        tags,
                        isNumber: typeof age === 'number',
                        text: avatar === undefined ? null : await avatar.text(),
                    }),
                    {
                        // Declared rather than derived, as everywhere in this file: a demo registers
                        // by hand. A FILE is `string`/`binary` — the wire form, which is what a
                        // published shape has to say, and the gate takes the local `File` beside it.
                        schemas: {
                            input: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    age: { type: 'number' },
                                    tags: { type: 'array', items: { type: 'string' } },
                                    avatar: { type: 'string', format: 'binary' },
                                },
                            },
                        },
                    },
                )
                register('rpc', [['demo/form/enrol', 'enrol']], { enrol })

                const posted = new FormData()
                posted.set('name', 'ada')
                posted.set('age', '36')
                posted.append('tags', 'x')
                posted.append('tags', 'y')
                posted.set('avatar', new File(['hello bytes'], 'a.txt'))
                // No stub in this call at all: the body is what a browser's own form serialises to.
                const answered = await wire.fetch('/__abide/rpc/demo/form/enrol', {
                    method: 'POST',
                    body: posted,
                })
                is('a hand-built FormData reaches the handler', await answered.json(), {
                    name: 'ada',
                    age: 36,
                    tags: ['x', 'y'],
                    isNumber: true,
                    text: 'hello bytes',
                })

                // The same three readings the query door makes, because it is the same reader: the
                // shape says `age` is a number though the entry is text, the same name twice is a
                // list, and one entry against a declared list is a list of one.
                const single = new FormData()
                single.set('name', 'ada')
                single.set('age', '36')
                single.set('tags', 'x')
                single.set('avatar', new File(['b'], 'b.txt'))
                const one = await wire.fetch('/__abide/rpc/demo/form/enrol', {
                    method: 'POST',
                    body: single,
                })
                is('a list of one is a list', ((await one.json()) as { tags: string[] }).tags, ['x'])

                // The OTHER spelling of a form — what a `<form method="post">` with no `enctype`
                // sends, and all a form without a file input ever needs. Nothing branches on which:
                // `Request.formData()` reads both into the same entries.
                const urlencoded = await wire.fetch('/__abide/rpc/demo/form/enrol', {
                    method: 'POST',
                    headers: { 'content-type': 'application/x-www-form-urlencoded' },
                    body: 'name=ada&age=36&tags=x&tags=y',
                })
                is(
                    'and urlencoded is the same call, minus what only multipart can carry',
                    await urlencoded.json(),
                    { name: 'ada', age: 36, tags: ['x', 'y'], isNumber: true, text: null },
                )

                // And the stub's own encoding — `__abide_args` plus a part per file — still reaches
                // the same handler. Two forms of one door, not two endpoints.
                const remoteEnrol = client<
                    { name: string; age: number; tags: string[]; avatar: File },
                    Record<string, unknown>
                >('demo/form/enrol', { method: 'POST' })
                is(
                    'the stub takes the same door and the handler cannot tell',
                    await remoteEnrol({
                        name: 'ada',
                        age: 36,
                        tags: ['x', 'y'],
                        avatar: new File(['hello bytes'], 'a.txt'),
                    }),
                    { name: 'ada', age: 36, tags: ['x', 'y'], isNumber: true, text: 'hello bytes' },
                )

                // A form that does not match is refused where every other door's mismatch is — 422
                // out of the input gate, not a decode failure.
                const wrong = new FormData()
                wrong.set('name', 'ada')
                wrong.set('age', 'thirty six')
                const refused = await wire.fetch('/__abide/rpc/demo/form/enrol', {
                    method: 'POST',
                    body: wrong,
                })
                is('and a form the shape refuses is a 422', refused.status, 422)
            },
        },

        {
            title: 'every endpoint publishes the shape a machine reads before calling it',
            note: 'This is what the shape story is FOR. Standard Schema is validate-only — it hands over a `validate` function and nothing that says what the shape IS — so a schema declared through one cannot become a tool definition or an OpenAPI operation. That is why JSON Schema is what a declaration MEANS rather than something abide converts to on the way out: an MCP tool is `{ name: id, description, inputSchema: input }` and an OpenAPI operation is the same three facts under other names, so neither projection derives anything — they add only what the catalogue has no reason to know, which is the wire. This is the document both read: `endpoints()` answers in-process and `GET /__abide/schema` answers over the wire — open, because every address in it is already in the client bundle and the shape beside it is the contract for calling one.',
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
                        // Resolved rather than declared: this endpoint said nothing, and what silence
                        // means is every surface — see `clients` on the declaration.
                        clients: { mcp: true, openapi: true },
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
            title: 'a FRAMED handler says it streams in the document, not only in the stub',
            note: 'The document is what a machine reads BEFORE it calls, so a `streams` it gets wrong is wrong at exactly the moment it matters. `isGenerator` cannot see a framing — `() => jsonl(items())` is an ordinary arrow — and `policy.framing` is learned from the first call’s VALUE, so a freshly started process described every framed endpoint as answering one value while the browser stub it had just built was already decoding chunks. The compiler is the only half that can say it up front, which is why `streams` now rides across `register` beside the shapes. It lands on its OWN policy field: `policy.streams` decides the call path, and a framing must not take that branch — trusting it there seeded the generator object, which is `{}`.',
            run({ is }) {
                const framed = GET(() => jsonl([{ id: 1 }, { id: 2 }]))
                const yielding = GET(async function* () {
                    yield { id: 1 }
                })
                const plain = GET(() => ({ ok: true }))
                register(
                    'rpc',
                    [
                        ['demo/framing/framed', 'framed'],
                        ['demo/framing/yielding', 'yielding'],
                        ['demo/framing/plain', 'plain'],
                    ],
                    { framed, yielding, plain },
                    // What `frames()` read off the syntax, which is the whole of what the runtime
                    // could not work out for itself. A generator needs no entry: `isGenerator` sees it.
                    { framed: { streams: true } },
                )
                const published = endpoints()
                const at = (id: string): boolean | undefined =>
                    published.find((one) => one.id === id)?.streams
                is('a framed endpoint publishes streams', at('demo/framing/framed'), true)
                is('…and so does one that yields, as it always did', at('demo/framing/yielding'), true)
                // The half that stops this reading as "say true": an endpoint answering with one
                // value must still say nothing, or the flag has stopped carrying a fact.
                is('one answering with a value does not', at('demo/framing/plain'), undefined)
            },
        },

        {
            title: 'a socket answers over ordinary HTTP as well as over a websocket',
            note: 'One address, three doors. A `GET` carrying `Upgrade: websocket` is the connection; a `GET` without one is the transcript-then-follow as ndjson; a `POST` is one message into the room. The two HTTP arms exist because a websocket is exactly what a generated client, a `curl` and an MCP tool call cannot hold — and they are the same room, through the same gates: `clientPublish` still decides whether a client may write at all, the declared message schema still refuses what does not match, and the socket’s middleware still runs on both the subscribe and the publish. What differs is only that a refusal here is a STATUS, because an HTTP request has a response to carry one in and a frame does not. `__abide_tail=n` is what makes a stream that never ends answerable: it takes n messages and closes, and breaking the iteration is what drops the subscription.',
            async run({ is }) {
                const lobby = socket<string, { room: string }>({
                    channel: { tail: 4 },
                    clientPublish: (message, _room, into) => {
                        into.publish(`echoed: ${message}`)
                    },
                })
                const broadcast = socket<{ n: number }>({ channel: { tail: 4 } })
                register(
                    'socket',
                    [
                        ['demo/http/lobby', 'lobby'],
                        ['demo/http/broadcast', 'broadcast'],
                    ],
                    { lobby, broadcast },
                    {
                        // The ROOM beside the message — the second type argument, which is what a tail
                        // or a publish has to name to reach one stream rather than another.
                        lobby: {
                            input: { type: 'string' },
                            room: ROOM_BY_NAME,
                        },
                    },
                )

                const sent = await wire.fetch('/__abide/socket/demo/http/lobby?room=one', {
                    method: 'POST',
                    body: JSON.stringify('hello'),
                })
                is('a POST is one message into the room', sent.status, 202)
                is('…and it says ACCEPTED, because what happens to it is the socket’s', await sent.json(), {
                    accepted: true,
                })

                // The bound is what makes this answerable at all — without it the response is a
                // stream that never ends, which is right for a browser and unusable here.
                const tailed = await wire.fetch('/__abide/socket/demo/http/lobby?room=one&__abide_tail=1', {})
                is('a GET with no upgrade header tails it', tailed.status, 200)
                is('…as one JSON value per line', tailed.headers.get('content-type'), 'application/jsonl')
                is('…carrying what the handler published', await tailed.text(), '"echoed: hello"\n')

                // The ROOM is what selects the stream, so a different one is a different transcript —
                // and this is the case that needs both bounds. A count alone never completes on a
                // room nobody has published into: the transcript is empty, so the first message it
                // is waiting for is one that may never come, and an empty answer and a hang are the
                // same thing to whoever asked.
                const elsewhere = await wire.fetch(
                    '/__abide/socket/demo/http/lobby?room=two&__abide_tail=1&__abide_wait=25',
                    {},
                )
                is('another room has none of it', await elsewhere.text(), '')

                const refused = await wire.fetch('/__abide/socket/demo/http/broadcast', {
                    method: 'POST',
                    body: JSON.stringify({ n: 1 }),
                })
                is('a socket that declared no `clientPublish` takes nothing', refused.status, 405)
            },
        },

        {
            title: 'the two publish doors run the same gates, and a gate missing from one is invisible',
            note: 'A socket takes a client message two ways — a `POST` to its address, and a frame on the websocket — and each runs the same five gates in the same order: `clientPublish` declared at all, the message readable, the declared schema, the middleware chain, then the handler. The chain is spelled twice rather than shared, because the frame path is guarded at every step where the request path may await, and that is the whole hazard: what holds them in step is a comment. A gate added to one door leaves the other OPEN, and nothing about either function says so — no test goes red, because each door on its own is still correct. So this asserts the doors AGAINST EACH OTHER. What differs is only how a refusal is said: a request has a response to carry a status, and a frame has none, so it is dropped in silence — which is why the frame arm is asserted on the ROOM rather than on an answer.',
            async run({ is }) {
                const guarded = socket<string, { room: string }>({
                    channel: { tail: 8 },
                    clientPublish: (message, _room, into) => {
                        into.publish(message)
                    },
                    middleware: [
                        (next, event) => {
                            if (event.kind === 'publish' && event.message === 'refuse me') {
                                throw new Error('not for you')
                            }
                            // The chain gates the SUBSCRIBE as well, and that arm has two doors of
                            // its own — the upgrade and the HTTP tail. A room nobody may join is how
                            // this case reaches both.
                            if (
                                event.kind === 'subscribe' &&
                                (event.room as { room?: string })?.room === 'closed'
                            ) {
                                throw new Error('not your room')
                            }
                            return next()
                        },
                    ],
                })
                const broadcast = socket<string>({ channel: { tail: 8 } })
                register(
                    'socket',
                    [
                        ['demo/gates/guarded', 'guarded'],
                        ['demo/gates/broadcast', 'broadcast'],
                    ],
                    { guarded, broadcast },
                    { guarded: { input: { type: 'string' }, room: ROOM_BY_NAME } },
                )

                const room = '/__abide/socket/demo/gates/guarded?room=gate'
                const shut = '/__abide/socket/demo/gates/broadcast'
                const post = (at: string, body: string): Promise<Response> =>
                    wire.fetch(at, { method: 'POST', body })

                // The request door says which gate refused, because it has a response to say it in.
                is('http · no `clientPublish` at all', (await post(shut, '"hello"')).status, 405)
                is('http · a body that is not JSON', (await post(room, 'not json')).status, 400)
                is('http · a message the declared schema refuses', (await post(room, '123')).status, 422)
                is('http · a message the chain refuses', (await post(room, '"refuse me"')).status, 403)
                is('http · and one that passes every gate', (await post(room, '"over http"')).status, 202)

                // The same five, as frames. Each is the drop the status above was, and the only
                // evidence either way is what reached the room.
                const closed = wire.open('ws://abide.test/__abide/socket/demo/gates/broadcast')
                const open = wire.open('ws://abide.test/__abide/socket/demo/gates/guarded?room=gate')
                await until(() => wire.connected >= 2)
                closed.send('"hello"')
                open.send('not json')
                open.send('123')
                open.send('"refuse me"')
                open.send('"over a frame"')
                await sleep(5)

                // The BOUNDS are what make a stream that never ends answerable, and the wait is what
                // makes this an assertion rather than a hang: a count alone would sit here forever
                // waiting for the frames the gates are supposed to have refused.
                const transcript = await wire.fetch(`${room}&__abide_tail=3&__abide_wait=25`, {})
                is(
                    'every gate refused the FRAME that the status refused the REQUEST',
                    await transcript.text(),
                    '"over http"\n"over a frame"\n',
                )
                const nothing = await wire.fetch(`${shut}?__abide_tail=1&__abide_wait=25`, {})
                is('…and a broadcast took neither', await nothing.text(), '')

                // The SUBSCRIBE arm has two doors of its own, through the same chain: the upgrade,
                // and the HTTP tail that exists for every caller which cannot hold a websocket. The
                // tail one had no assertion at all until this — removing its gate broke nothing.
                const tail = await wire.fetch(
                    '/__abide/socket/demo/gates/guarded?room=closed&__abide_tail=1',
                    {},
                )
                is('http · a subscribe the chain refuses', tail.status, 403)
                const upgrade = wire.open('ws://abide.test/__abide/socket/demo/gates/guarded?room=closed')
                let shutOut = false
                upgrade.onclose = (): void => {
                    shutOut = true
                }
                await sleep(5)
                is('ws · the same subscribe, refused at the handshake', shutOut, true)

                closed.close()
                open.close()
            },
        },

        {
            title: 'the same catalogue, as an OpenAPI document nobody wrote',
            note: 'Not a second derivation — a PROJECTION. The shape is already JSON Schema, so an operation is the facts `endpoints()` carries under OpenAPI’s names for them, and 3.1 is what makes that free: its schema object IS JSON Schema, where a 3.0 document would need translating on the way out — the exact projection the shape language was inverted to avoid. What the projection adds is the WIRE, which the catalogue has no reason to know: a read spends its args one query parameter EACH, so they become `parameters`; a mutation’s become a JSON body; a `format: "binary"` member makes that body multipart; a handler that yields answers `x-ndjson`; and a socket contributes its tail and publish arms rather than an operation it cannot have.',
            async run({ is }) {
                const find = GET(({ q }: { q: string }) => [q], { description: 'Find things' })
                const upload = POST(({ file }: { file: File }) => file.name, { description: 'Take a file' })
                const quiet = POST(({ x }: { x: number }) => x, { clients: { openapi: false } })
                // Its own socket rather than the one the case above registered: a case that reads
                // what another case wrote passes or fails on the ORDER they run in, which is not
                // what either of them is about.
                const feed = socket<string, { room: string }>({
                    clientPublish: (message, _room, into) => {
                        into.publish(message)
                    },
                })
                register(
                    'socket',
                    [['demo/api/feed', 'feed']],
                    { feed },
                    {
                        feed: {
                            input: { type: 'string' },
                            room: ROOM_BY_NAME,
                        },
                    },
                )
                register(
                    'rpc',
                    [
                        ['demo/api/find', 'find'],
                        ['demo/api/upload', 'upload'],
                        ['demo/api/quiet', 'quiet'],
                    ],
                    { find, upload, quiet },
                    {
                        find: {
                            input: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
                        },
                        upload: {
                            input: {
                                type: 'object',
                                properties: { file: { type: 'string', format: 'binary' } },
                                required: ['file'],
                            },
                        },
                        quiet: {
                            input: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
                        },
                    },
                )

                const served = await wire.fetch('/__abide/openapi.json', {})
                const document = (await served.json()) as {
                    openapi: string
                    paths: Record<
                        string,
                        Record<string, { parameters?: { name: string }[]; requestBody?: unknown }>
                    >
                }
                is('the document is served beside the schema', served.status, 200)
                is('…as OpenAPI 3.1, whose schema object IS JSON Schema', document.openapi, '3.1.0')

                const read = document.paths['/__abide/rpc/demo/api/find']?.get
                is(
                    'a read spends its args as query parameters, one each',
                    read?.parameters?.map((one) => one.name),
                    ['q'],
                )

                const file = document.paths['/__abide/rpc/demo/api/upload']?.post
                const body = file?.requestBody as { content: Record<string, unknown> } | undefined
                is('a `binary` member is what makes a body multipart', Object.keys(body?.content ?? {}), [
                    'multipart/form-data',
                ])

                // A socket has no operation of its own — an upgrade is not a call — so what it
                // publishes is the pair of HTTP arms the case above serves.
                const tail = document.paths['/__abide/socket/demo/api/feed']
                is('a socket contributes its tail and its publish', Object.keys(tail ?? {}).sort(), [
                    'get',
                    'post',
                ])
                is(
                    '…the ROOM is what a tail names to reach one, and both bounds are how it ends',
                    tail?.get?.parameters?.map((one) => one.name),
                    ['room', '__abide_tail', '__abide_wait'],
                )

                is(
                    'and a declaration that opted out is not in it',
                    Object.hasOwn(document.paths, '/__abide/rpc/demo/api/quiet'),
                    false,
                )

                // The same document WITHOUT the wire, which is what the `abide/server/internal` door
                // is for: a build step writing the spec to a file has no server to fetch from, and it
                // is the one caller that needs to say what the API is called when that is not what
                // the package is called. Everything else is still derived.
                const named = openapi({
                    title: 'The Catalogue',
                    version: '9.9.9',
                    description: 'Hand-named.',
                })
                is(
                    'called directly, only the prose is the caller’s to name',
                    [named.info.title, named.info.version, named.info.description],
                    ['The Catalogue', '9.9.9', 'Hand-named.'],
                )
                is(
                    '…and the paths are the same ones the wire served',
                    Object.keys(named.paths).sort(),
                    Object.keys(document.paths).sort(),
                )
            },
        },

        {
            title: 'every declaration is a tool an agent can call, over MCP',
            note: 'The same projection, aimed at the other reader. An MCP tool IS `{ name, description, inputSchema }`, so `tools/list` is the catalogue with nothing converted — and `tools/call` does not reach a handler at all: it builds a request to the app’s OWN `/__abide/` door and re-enters `dispatch`, so every policy, middleware rung, schema gate and refusal applies exactly once, in the place that already owned it. A second path to a handler would be a second security posture. The transport is JSON-RPC 2.0 over one POST — a `switch` over four method names, and no dependency. Two things it must translate: an address is not a legal tool name for the clients that consume these, so `users/getUser` is sanitised and the true address kept as the `title`; and a SCHEMA REFUSAL comes back as a RESULT with `isError`, not as a protocol error, because an agent can act on "q: expected string" and cannot act on `-32602`.',
            async run({ is }) {
                // Its own endpoints, for the reason the case above registers its own: a case that
                // reads what another wrote passes or fails on the order they ran in.
                const find = GET(({ q }: { q: string }) => [q], { description: 'Find things' })
                const hidden = POST(({ x }: { x: number }) => x, { clients: { mcp: false } })
                const events = GET(() =>
                    sse(
                        (async function* () {
                            yield { at: 1 }
                            yield { at: 2 }
                        })(),
                    ),
                )
                const lobby = socket<string, { room: string }>({
                    channel: { tail: 4 },
                    clientPublish: (message, _room, into) => {
                        into.publish(`echoed: ${message}`)
                    },
                })
                const outward = socket<{ n: number }>()
                register(
                    'rpc',
                    [
                        ['demo/tool/find', 'find'],
                        ['demo/tool/hidden', 'hidden'],
                        ['demo/tool/events', 'events'],
                    ],
                    { find, hidden, events },
                    {
                        find: {
                            input: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
                        },
                        hidden: {
                            input: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
                        },
                    },
                )
                register(
                    'socket',
                    [
                        ['demo/tool/lobby', 'lobby'],
                        ['demo/tool/outward', 'outward'],
                    ],
                    { lobby, outward },
                    {
                        lobby: {
                            input: { type: 'string' },
                            room: ROOM_BY_NAME,
                        },
                    },
                )

                // What a conforming client sends, and the whole of what this revision needs: the
                // version and the capabilities travel in `_meta` on EVERY request, because there is
                // no handshake left to have settled them, and the two are mirrored into headers so
                // an intermediary can route without parsing the body.
                const VERSION = '2026-07-28'
                const ask = (
                    body: Record<string, unknown>,
                    extra?: Record<string, string>,
                ): Promise<Response> =>
                    wire.fetch('/__abide/mcp', {
                        method: 'POST',
                        headers: {
                            'content-type': 'application/json',
                            'mcp-protocol-version': VERSION,
                            'mcp-method': String(body.method),
                            ...extra,
                        },
                        body: JSON.stringify(body),
                    })
                const called = (
                    method: string,
                    params: Record<string, unknown> = {},
                ): Record<string, unknown> => ({
                    jsonrpc: '2.0',
                    id: 1,
                    method,
                    params: {
                        ...params,
                        _meta: {
                            'io.modelcontextprotocol/protocolVersion': VERSION,
                            'io.modelcontextprotocol/clientCapabilities': {},
                        },
                    },
                })
                const call = async (
                    method: string,
                    params?: Record<string, unknown>,
                ): Promise<Record<string, never>> => {
                    const body = called(method, params)
                    // `Mcp-Name` is required on a tools/call and must match the body, so it rides here
                    // rather than at each call site.
                    const named = method === 'tools/call' ? { 'mcp-name': String(params?.name) } : undefined
                    const answered = await ask(body, named)
                    return (await answered.json()) as Record<string, never>
                }

                const found = (await call('server/discover')) as unknown as {
                    result: {
                        resultType: string
                        supportedVersions: string[]
                        capabilities: { tools: object }
                    }
                }
                is(
                    'discovery replaces the handshake — one request, and no state behind it',
                    [found.result.supportedVersions, Object.hasOwn(found.result.capabilities, 'tools')],
                    [[VERSION], true],
                )
                is('and every result says which KIND of result it is', found.result.resultType, 'complete')

                const listed = (await call('tools/list')) as unknown as {
                    result: { tools: { name: string; title: string }[] }
                }
                const byTitle = new Map(listed.result.tools.map((one) => [one.title, one.name]))
                is(
                    'an address is sanitised into a name a tool client accepts',
                    byTitle.get('demo/tool/find'),
                    'demo_tool_find',
                )
                is(
                    '…and a socket is two tools, because it has two arms',
                    [byTitle.get('demo/tool/lobby (tail)'), byTitle.get('demo/tool/lobby (publish)')],
                    ['demo_tool_lobby_tail', 'demo_tool_lobby_publish'],
                )
                is(
                    'a broadcast socket offers no publish tool at all',
                    byTitle.has('demo/tool/outward (publish)'),
                    false,
                )
                is('and a declaration that opted out is not a tool', byTitle.has('demo/tool/hidden'), false)

                const answered = (await call('tools/call', {
                    name: 'demo_tool_find',
                    arguments: { q: 'ada' },
                })) as unknown as { result: { content: { text: string }[] } }
                is('calling one runs the real handler', JSON.parse(answered.result.content[0]?.text ?? ''), [
                    'ada',
                ])

                // The gate the endpoint already had, reached through the tool door — nothing about
                // the check is MCP's, which is the whole claim.
                const wrong = (await call('tools/call', {
                    name: 'demo_tool_find',
                    arguments: { q: 7 },
                })) as unknown as { result: { isError: boolean; content: { text: string }[] } }
                is('a refusal is a RESULT an agent can act on', wrong.result.isError, true)
                is(
                    '…carrying what the declared shape actually said',
                    /q: expected string/.test(wrong.result.content[0]?.text ?? ''),
                    true,
                )

                // The rooms of the socket case above, reached as tools.
                const published = (await call('tools/call', {
                    name: 'demo_tool_lobby_publish',
                    arguments: { room: { room: 'three' }, message: 'over mcp' },
                })) as unknown as { result: { content: { text: string }[] } }
                is(
                    'publishing through a tool is the same publish',
                    JSON.parse(published.result.content[0]?.text ?? ''),
                    {
                        accepted: true,
                    },
                )
                const drained = (await call('tools/call', {
                    name: 'demo_tool_lobby_tail',
                    arguments: { room: { room: 'three' }, limit: 1 },
                })) as unknown as { result: { content: { text: string }[] } }
                is(
                    '…and tailing it reaches the same room',
                    JSON.parse(drained.result.content[0]?.text ?? ''),
                    ['echoed: over mcp'],
                )

                // EVERY framing the wire can answer in, decoded — the tool door drains the response
                // through `chunksOf` rather than a reader of its own, so `sse()` arrives as values.
                // Read as text, this is `data: {"at":1}` lines and an agent has to parse the frame.
                const streamed = (await call('tools/call', {
                    name: 'demo_tool_events',
                    arguments: {},
                })) as unknown as { result: { content: { text: string }[] } }
                is(
                    'an event-stream answer reaches the agent as values, not as frames',
                    JSON.parse(streamed.result.content[0]?.text ?? ''),
                    [{ at: 1 }, { at: 2 }],
                )

                // A name the client chose to WRAP. abide sanitises every tool name into the safe
                // set, so nothing here needs the sentinel — but a conforming client must wrap any
                // value that merely LOOKS like one, so the server has to decode before comparing or
                // it refuses exactly the names the encoding exists to carry.
                const wrapped = await ask(
                    called('tools/call', { name: 'demo_tool_find', arguments: { q: 'ada' } }),
                    { 'mcp-name': `=?base64?${btoa('demo_tool_find')}?=` },
                )
                const unwrapped = (await wrapped.json()) as { result: { content: { text: string }[] } }
                is(
                    'a Base64-wrapped `Mcp-Name` is decoded before it is compared',
                    JSON.parse(unwrapped.result.content[0]?.text ?? ''),
                    ['ada'],
                )

                // WHAT THE STATELESS REVISION REFUSES, and each one with the status a client reads
                // before the body: it is how a modern server is told apart from a legacy one.
                const mismatched = await ask(
                    { ...called('tools/list'), method: 'tools/list' },
                    {
                        'mcp-method': 'tools/call',
                    },
                )
                is(
                    'a header that disagrees with the body is refused, not preferred',
                    [
                        mismatched.status,
                        ((await mismatched.json()) as { error: { code: number } }).error.code,
                    ],
                    [400, -32020],
                )

                const old = await ask(
                    {
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'tools/list',
                        params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2025-06-18' } },
                    },
                    { 'mcp-protocol-version': '2025-06-18' },
                )
                const refused = ((await old.json()) as { error: { code: number; data: unknown } }).error
                is(
                    'a revision abide does not speak comes back NAMING the ones it does',
                    [old.status, refused.code, refused.data],
                    [400, -32022, { supported: [VERSION], requested: '2025-06-18' }],
                )

                const unknown = await ask(called('resources/list'))
                is(
                    'a method that does not exist is a 404, which is what tells a client to stop asking',
                    [unknown.status, ((await unknown.json()) as { error: { code: number } }).error.code],
                    [404, -32601],
                )

                // Removed in 2025-06-18 and never coming back — accepting one would be answering for
                // a protocol nobody speaks.
                const batched = await ask([called('tools/list')] as unknown as Record<string, unknown>)
                is('a batch is refused outright', batched.status, 400)

                // The GET that opened a standalone stream and the DELETE that ended a session, both
                // removed with sessions themselves.
                const streaming = await wire.fetch('/__abide/mcp', {})
                is('and the GET an older client opens a stream with is 405', streaming.status, 405)

                // The mitigation this transport's own spec asks for by name: a page the user merely
                // visited must not be able to drive every tool the app publishes.
                const rebound = await wire.fetch('/__abide/mcp', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', origin: 'http://elsewhere.test' },
                    body: '{}',
                })
                is('and it is closed to a cross-origin caller', rebound.status, 403)
            },
        },

        {
            title: 'bytes are a VALUE, and the same value on both sides',
            note: 'The isomorphism rule, at the one place it is easiest to lose: an image is not JSON. A handler answering with bytes RETURNS them — it does not build a `Response` — because a `Response` is not isomorphic. Read in-process it is an object the caller has to unwrap; read over the wire it is the payload, so the same callable answers two different things depending on which side asked, which is exactly what `rpc` exists to make impossible. So the four binary shapes travel as `application/octet-stream` and decode back to a `Uint8Array`, and a `Blob` keeps the type it was given. Building a `Response` is still allowed and still passes through — it is the escape hatch for a route that means something specific — but it is a SERVER answer rather than a value.',
            async run({ is }) {
                // Not valid UTF-8, which is the whole point: `.text()` on these is lossy and silent.
                const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe])
                const icon = GET(() => PNG)
                register('rpc', [['demo/bytes/icon', 'icon']], { icon })

                const inProcess = await icon({})
                is('in-process, the bytes themselves', inProcess instanceof Uint8Array, true)

                // Through the WIRE rather than through the decoder directly: the claim is about what
                // a caller on the other side receives, and a helper asserted in isolation is a claim
                // about the helper.
                const overWire = await client<Record<string, never>, Uint8Array>('demo/bytes/icon')({})
                is('over the wire, bytes again', overWire instanceof Uint8Array, true)
                // The two sides COMPARED, not each checked against the literal — "same value on both
                // sides" is the claim, and two assertions against `PNG` would both pass with one of
                // them handing back something else entirely.
                is('and the two agree byte for byte', [...overWire], [...inProcess])
                is(
                    '…under a type that says what it is',
                    (await icon.raw({})).headers.get('content-type'),
                    'application/octet-stream',
                )

                // The shape that used to be `{}` — a 200 with the payload gone and nothing to say so.
                const sheet = GET(() => new Blob([PNG], { type: 'image/png' }))
                const carried = await sheet.raw({})
                is('a Blob keeps the type it was given', carried.headers.get('content-type'), 'image/png')
                is('…and its bytes survive', [...new Uint8Array(await carried.arrayBuffer())], [...PNG])

                // The other direction, so the binary arm cannot have swallowed the ordinary one.
                const row = GET(() => ({ id: 1 }))
                register('rpc', [['demo/bytes/row', 'row']], { row })
                is(
                    'a plain value is still JSON',
                    (await row.raw({})).headers.get('content-type'),
                    'application/json',
                )
                is(
                    '…and decodes to the object',
                    await client<Record<string, never>, { id: number }>('demo/bytes/row')({}),
                    { id: 1 },
                )

                // A body abide did NOT write — a proxy's plain-text refusal, carrying no
                // `content-type` at all. It has to arrive as text: read as bytes it is a diagnostic
                // nobody can read, and that is the case deciding which way the allowlist points.
                // Unnamed is TEXT; only a type that is named and not textual decodes as bytes.
                // `remote` directly rather than `client`, which fixes the fetch this has to replace.
                const proxied = remote<Record<string, never>, unknown>('demo/bytes/absent', {
                    base: wire.base,
                    fetch: () => Promise.resolve(new Response('gateway timeout')),
                })
                is('an untyped body is text, not bytes', await proxied({}), 'gateway timeout')
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
                is(
                    'and a file under neither elides to nothing at all',
                    elide(source, { filename: '/app/db.ts' }),
                    null,
                )
                is('the stub carries the address', browser?.code.includes('"users/getUser"'), true)
                is('…and none of the handler', browser?.code.includes('findUser'), false)
                // The SPECIFIER is a bundling fact, not a naming one, and it is asserted here because
                // nothing else can see it: `abide/runtime` is what the generated client entry imports
                // for `routes`/`outlet`/`ready`, so a stub reaching the transport THROUGH it puts the
                // whole call-and-decode path in the chunk every page loads — 4,066 bytes of the perf
                // app's shared entry, for one lazy route with one rpc. Its own specifier is not
                // reachable from that entry, so it lands in the chunk of the page that has the rpc.
                is(
                    'the stub imports the transport by its OWN specifier',
                    browser?.code.includes(`from "abide/runtime/transport"`),
                    true,
                )
                is(
                    '…and never through the barrel the client entry already pulls in',
                    browser?.code.includes(`from "abide/runtime"`),
                    false,
                )
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

                // The other way a handler says its answer arrives in chunks. An arrow cannot be a
                // generator, so before this the stub for a framed endpoint claimed one value and the
                // caller had to take the body apart by hand.
                const framed = `export const feed = GET(() => jsonl(items()))\n`
                is(
                    'a handler that FRAMES one says so too',
                    elide(framed, { filename: USERS, browser: true })?.code.includes('stream: true'),
                    true,
                )
                const evented = `export const feed = GET(() => sse(items()))\n`
                is(
                    '…by either helper',
                    elide(evented, { filename: USERS, browser: true })?.code.includes('stream: true'),
                    true,
                )
                // The claim is about a SEQUENCE, so a response holding one value must not be caught
                // by it — a `stream: true` here would hand every caller a transcript where they asked
                // for the value.
                is(
                    'and a handler answering with one value does NOT',
                    elide(`export const feed = GET(() => json({ ok: true }))\n`, {
                        filename: USERS,
                        browser: true,
                    })?.code.includes('stream: true'),
                    false,
                )

                // Both lanes or neither. The stub is what a BROWSER was told; the registration is what
                // the SERVER is told, and while only the first carried it the document described a
                // framed endpoint as answering one value until somebody had already called it.
                is(
                    'the server lane is told the same thing',
                    elide(framed, { filename: USERS })?.code.includes('"streams":true'),
                    true,
                )
                is(
                    '…and is not told it about a single value',
                    elide(`export const feed = GET(() => json({ ok: true }))\n`, {
                        filename: USERS,
                    })?.code.includes('"streams":true'),
                    false,
                )

                throws(
                    'a non-endpoint export is an error naming the export',
                    () => elide(`export function helper() { return 1 }\n`, { filename: USERS }),
                    /exports `function`/,
                )

                // A module whose whole job is one endpoint addresses as the MODULE — `users`, not
                // `users/handler` — so a route that IS the module does not repeat itself in its own
                // address. What it may not do is declare the handler inline: the server lane is the
                // module unchanged plus an APPENDED registration, and that registration maps an
                // address to a local NAME. `export default POST(…)` declares no name, and a module
                // cannot reach its own default export to supply one.
                const defaulted = `const handler = POST(() => 1)\nexport default handler\n`
                is(
                    'a defaulted endpoint is addressed by the module alone',
                    elide(defaulted, { filename: USERS })?.code.includes('[["users","handler"]]'),
                    true,
                )
                is(
                    '…and the stub is a default too, so the import side is unchanged',
                    elide(defaulted, { filename: USERS, browser: true })
                        ?.code.trim()
                        .endsWith('export default __remote("users", { method: "POST" })'),
                    true,
                )
                // The binding may be declared BELOW the export that names it, because hoisting is
                // what a reader expects and a one-pass rule would forbid it for no reason.
                is(
                    'the const may sit under the default that names it',
                    elide(`export default handler\nconst handler = POST(() => 1)\n`, { filename: USERS })
                        ?.endpoints[0]?.asDefault,
                    true,
                )
                throws(
                    'declaring it inline says how to bind it',
                    () => elide(`export default POST(() => 1)\n`, { filename: USERS }),
                    /bind it first/,
                )
                throws(
                    'exporting AND defaulting one endpoint would address it twice',
                    () => elide(`export const h = POST(() => 1)\nexport default h\n`, { filename: USERS }),
                    /address one endpoint twice/,
                )
                throws(
                    'a default naming nothing in the module is an error naming it',
                    () => elide(`export default missing\n`, { filename: USERS }),
                    /is not declared here/,
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
                    [
                        {
                            name: 'ticks',
                            method: 'socket',
                            asDefault: false,
                            streams: false,
                            input: { type: 'number' },
                            output: undefined,
                            // One stream, addressed by nothing — a room is what a KEYED socket has.
                            room: undefined,
                        },
                    ],
                )
                is(
                    '…and a keyed one derives the ROOM beside the message',
                    elide(`export const rooms = socket<string, { room: string }>()\n`, { filename: FEED })
                        ?.endpoints,
                    // The second type argument ADDRESSES a subscriber rather than travelling to one,
                    // so it is carried under its own name. Without it the generated tail and publish
                    // arms have no way to say which room they act on, which is a tool nobody can call.
                    [
                        {
                            name: 'rooms',
                            method: 'socket',
                            asDefault: false,
                            streams: false,
                            input: { type: 'string' },
                            output: undefined,
                            room: {
                                type: 'object',
                                properties: { room: { type: 'string' } },
                                required: ['room'],
                                // Written, like every field of a derived object schema — see the
                                // note on the inline literal above.
                                additionalProperties: undefined,
                            },
                        },
                    ],
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
            title: 'the room a DECLARATION holds outlives its last subscriber',
            note: 'What `tail` promises — how many messages a late subscriber is caught up with — and it is a promise about a GAP, since a late subscriber is by definition one that was not there. The bare stream a socket used to hand out kept it for free: a channel has no owner to be forgotten by. Once `s()` became an ordinary room it came under the sweep that bounds the room table, so the transcript went with the last client to disconnect, and a server holding the room published into an orphan nobody could reach. Rooms a CALLER names still go — that table is one an arriving connection can grow without a bound, and that is what the sweep is for. Asserted across a disconnect, because nothing that only ever connects can see it.',
            async run({ is }) {
                const held = socket<{ n: number }>({ channel: { tail: 4 } })
                held().publish({ n: 1 })
                held().publish({ n: 2 })

                // One subscriber arrives and leaves — the sweep's trigger.
                const stop = held().subscribe(() => {})
                stop()

                is('the transcript survived the gap', held().chunks(), [{ n: 1 }, { n: 2 }])
                // The same object, so a server holding `s()` is still publishing where readers look.
                const after = held()
                held().publish({ n: 3 })
                is('…and it is still the room a publisher holds', after.chunks(), [
                    { n: 1 },
                    { n: 2 },
                    { n: 3 },
                ])

                // A room a CALLER named is not held, and still goes — the bound this must not remove.
                const named = socket<{ n: number }, { room: string }>({ channel: { tail: 4 } })
                const one = named({ room: 'a' })
                const leave = one.subscribe(() => {})
                leave()
                is('a caller-named room is still swept', named({ room: 'a' }) === one, false)
            },
        },

        {
            title: 'a socket has no bare stream — the omitted call is the `{}` room',
            note: 'Full parity with the other law: there is no argless rpc, because `Rpc` extends `KeyedMemo` and `asRpc` resolves an omitted argument to `{}` — so `f()` and `f({})` are one slot at one address. A socket resolves the same way, so `s()` and `s({})` are one room on one connection, and the bare stream `channel()` still has is one a socket simply never hands out. That is what makes the two halves of the sentence "adding transport collapses the two forms into one" true rather than nearly true: before this, `s()` was a third thing, neither a room nor a read. The WIRE is the one place the two laws encode `{}` differently, and it is deliberate — an rpc\'s args ARE its address and must reach a handler as `{}` rather than as nothing, while a room is re-resolved by this same coercion on the server, so an empty query and an explicit `{}` already land in the same room from both directions.',
            async run({ is }) {
                const both = socket<{ n: number }, { room?: string }>({ channel: { tail: 4 } })
                is('the omitted call and `{}` are one room', both() === both({}), true)
                is('…and a named room is not that one', both({ room: 'a' }) === both(), false)
                // An explicit `undefined` is the THIRD spelling of the same room, and it is the one
                // arity cannot see: left on `given.length` it reached `channel()`'s own call, which
                // branches on VALUE and reads — handing back a message where the type says `Channel`.
                is('…and an explicit `undefined` is that room too', both(undefined) === both(), true)

                // The server half, over the wire: a client that omits the room and one that sends
                // `{}` must reach what `s()` published into.
                register('socket', [['demo/socket/parity', 'both']], { both })
                const upgraded = wire.connected
                const held = { channel: { tail: 4 } }
                const omitted = sock<{ n: number }, { room?: string }>('demo/socket/parity', held)
                const explicit = sock<{ n: number }, { room?: string }>('demo/socket/parity', held)
                omitted().chunks()
                explicit({}).chunks()
                await until(() => wire.connected >= upgraded + 2)

                both().publish({ n: 7 })
                await until(() => omitted().chunks().length === 1 && explicit({}).chunks().length === 1)
                is('the omitted client received it', omitted().peek(), { n: 7 })
                is('and so did the one that sent `{}`', explicit({}).peek(), { n: 7 })
                omitted.close()
                explicit.close()

                // The WIRE, which the two claims above cannot see: the server re-resolves an
                // undecoded room into `{}`, so delivery is right whichever address the client used.
                // What decides it is that a socket's `{}` room has nothing to say on a query — where
                // an rpc's `f()` must carry `?__abide_args={}` so the HANDLER is handed `{}` rather
                // than nothing. Asserted, or the two encodings drift without a symptom.
                const dialled: string[] = []
                const watched = remoteSocket<{ n: number }, { room?: string }>('demo/socket/parity', {
                    base: wire.base,
                    open: (at) => {
                        dialled.push(at.slice(at.indexOf('/__abide')))
                        return wire.open(at)
                    },
                })
                watched().chunks()
                watched({ room: 'named' }).chunks()
                await until(() => dialled.length === 2)
                is('the `{}` room addresses the bare path', dialled[0], '/__abide/socket/demo/socket/parity')
                is(
                    'a named room carries its query',
                    dialled[1],
                    '/__abide/socket/demo/socket/parity?room=named',
                )
                watched.close()
            },
        },

        {
            title: 'NAMING a socket opens nothing; SELECTING opens nothing; ASKING opens it',
            note: 'A socket always selects, so it is on the ordinary kick rule rather than exempt from it — `s()` is to a connection what `m(args)` is to a slot. A probe answering off a `Connection` that might not exist is a fact wearing the wrong answer for the same reason a cold slot probing `false` was — "no load is running" where the truth is "none has begun" — and it costs twice on a page. A socket whose only mention is a probe never connects at all; and the guard the shape invites, `s.pending() ? fallback : s()`, cannot short-circuit its own first evaluation, so it falls through to the read and defers the region it was written to keep painting. Asserted over the WHOLE probe list, so the next member added is not quietly wired to the wrong arm, and over `isError` separately, because it is the one probe with no cold value to answer from and it once threw out of a member the spec says never does.',
            async run({ is }) {
                const quiet = socket<{ n: number }>({ channel: { tail: 2 } })
                register('socket', [['demo/socket/quiet', 'quiet']], { quiet })
                const idle = sock<{ n: number }>('demo/socket/quiet')
                const before = wire.connected

                // Naming it, and selecting it. Neither is a question, so neither opens anything —
                // the same two acts that are free on a keyed memo.
                const held = idle()
                is('selecting opened nothing', wire.connected, before)

                // `isError` answers from its ARGUMENTS and has no cold value to read, so it is the
                // one probe that still starts nothing — the same way `peek` does on a state.
                is('isError says no for an unrelated failure', held.isError(new Error('x'), 'Nope'), false)
                const named = new Error('inner')
                named.name = 'Nope'
                is(
                    'and yes for the named one, wrapped as a cause',
                    held.isError(new Error('outer', { cause: named }), 'Nope'),
                    true,
                )
                is('…and neither ask opened it', wire.connected, before)

                // Now ASK. A connection is a load, so the first probe starts it and reports it.
                is('pending, which is what asking started', held.pending(), true)
                await until(() => wire.connected > before)
                is('the rest of the probe list still answers', held.refreshing(), false)
                is('settled', held.settled(), false)
                is('done', held.done(), false)
                is('streaming', held.streaming(), true)
                is('error', held.error(), undefined)
                is('peek', held.peek(), undefined)
                is('one connection, not one per probe', wire.connected, before + 1)
                idle.close()
            },
        },

        {
            title: 'a socket is `channel()` with subscribers that arrived over a wire',
            note: 'The server half is `channel()` UNCHANGED — the transport is not in the channel, it is one `subscribe` on upgrade and one unsubscribe on close. Both sides are a `Channel`, so a component iterating one, calling one, or reading `chunks()` cannot tell which side it is on.',
            async run({ is }) {
                const ticks = socket<{ n: number }>({ channel: { tail: 8 } })
                register('socket', [['demo/socket/ticks', 'ticks']], { ticks })
                const remoteTicks = sock<{ n: number }>('demo/socket/ticks', { channel: { tail: 8 } })

                const live = remoteTicks()
                is('nothing has arrived', live.peek(), undefined)
                const upgraded = wire.connected
                // Selecting hands back the connection and opens nothing; ASKING it is what opens it,
                // and a read is one of the asks — see the probe case above.
                live()
                // Waited for, not slept past: the upgrade is a detached turn of the loop, and a
                // publish that beats it is dropped rather than queued.
                await until(() => wire.connected > upgraded)

                // Published on the SERVER, into a plain channel. Nothing about the publish knows a
                // socket exists.
                const served = ticks()
                served.publish({ n: 1 })
                served.publish({ n: 2 })
                await until(() => live.chunks().length === 2)

                is('the client channel holds the transcript', live.chunks(), [{ n: 1 }, { n: 2 }])
                is('…and the latest', live.peek(), { n: 2 })
                is('the whole source surface answers', live.settled(), true)
                is('a channel never loads, so it never ends', live.done(), false)
                remoteTicks.close()
            },
        },

        {
            title: 'a room encodes a message once, however many are listening to it',
            note: 'A publish hands every listener the SAME object, so a subscription per connection ran a `JSON.stringify` per connection over it — N identical walks producing byte-identical output, which at a thousand subscribers is a hundred times the encoding for one message. One subscription per room, encoding where the message arrives rather than where it leaves, makes it one. Nothing about what the clients receive changes, which is why the claim is a count of encodes rather than of frames.',
            async run({ is }) {
                const feed = socket<{ n: number }>({ channel: { tail: 4 } })
                register('socket', [['demo/socket/fanout', 'feed']], { feed })

                // Four independent client channels on one address is four connections into one room.
                const listeners: RemoteSocket<{ n: number }>[] = []
                for (let i = 0; i < 4; i++) {
                    listeners.push(sock<{ n: number }>('demo/socket/fanout', { channel: { tail: 4 } }))
                }
                const upgraded = wire.connected
                const held = listeners.map((listening) => listening())
                for (const room of held) room()
                await until(() => wire.connected >= upgraded + listeners.length)

                const encodes = countCalls(JSON, 'stringify')
                feed().publish({ n: 1 })
                encodes.restore()
                is('one encode for the publish, not one per subscriber', encodes.calls, 1)

                await until(() => held[0]?.chunks().length === 1)
                for (const room of held) {
                    is('…and every subscriber got it', room.peek(), { n: 1 })
                }
                for (const listening of listeners) listening.close()
            },
            interact({ host, log }) {
                const feed = socket<string>({ channel: { tail: 6 } })
                register('socket', [['demo/live/feed', 'feed']], { feed })
                const remoteFeed = sock<string>('demo/live/feed', { channel: { tail: 6 } })
                const out = stage(host)
                const shown = el('p', 'font-mono text-xs text-verdigris min-h-5')
                out.append(shown)
                const live = remoteFeed()
                const served = feed()
                reader(() => {
                    shown.textContent = live.chunks().join(' · ') || '(nothing yet)'
                    log.live('client peek()', live.peek())
                })
                let n = 0
                host.append(
                    row(
                        button('publish on the SERVER', () => served.publish(`tick ${++n}`)),
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
            title: 'an over-size body is 413 BEFORE it is buffered',
            note: 'The point of this door is WHERE it stands: the declared `content-length` is read and refused before `request.json()` or `.formData()` is ever reached, so a body too large to accept is also one abide never holds. Reading it after buffering would be a check that costs exactly what it exists to avoid. Two arms because there are two knobs and one is not the other’s default — a declaration’s `maxBodySize` is the endpoint’s own, and `ABIDE_MAX_REQUEST_BODY_SIZE` is the process floor an endpoint that declared nothing falls through to, resolved at the DOOR because a declaration runs at import and could not have seen an `onConfig` registered after it. The default is `Infinity`, which is the reading under which the branch never executes at all — so a case asserting the floor asserts nothing about this.',
            async run({ is }) {
                const tight = POST(({ text }: { text: string }) => ({ length: text.length }), {
                    maxBodySize: 16,
                })
                const open = POST(({ text }: { text: string }) => ({ length: text.length }))
                register(
                    'rpc',
                    [
                        ['demo/size/tight', 'tight'],
                        ['demo/size/open', 'open'],
                    ],
                    { tight, open },
                )

                const big = JSON.stringify({ text: 'x'.repeat(200) })
                const small = JSON.stringify({ text: 'ok' })

                // `content-length` is spelled out because that is literally what this door reads —
                // SPEC says an over-size DECLARED length is refused, and a sender that declares none
                // is the arm below. A real client's runtime writes it; a loopback `Request` built
                // from a string does not, which is itself the reason the absent case is asserted.
                const sized = (body: string): RequestInit => ({
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'content-length': String(new TextEncoder().encode(body).length),
                    },
                    body,
                })

                const refused = await wire.fetch('/__abide/rpc/demo/size/tight', sized(big))
                is('over the declared ceiling is 413', refused.status, 413)
                is('and the refusal says the ceiling', (await refused.text()).includes('16'), true)

                // Nothing DECLARED is nothing to compare, so this door lets it by — the ceiling is
                // not a buffering limit and does not pretend to be one.
                const undeclared = await wire.fetch('/__abide/rpc/demo/size/tight', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: big,
                })
                is('a body that declares no length is not refused here', undeclared.status, 200)

                const accepted = await wire.fetch('/__abide/rpc/demo/size/tight', sized(small))
                is('under it is served', accepted.status, 200)

                // The endpoint that declared nothing: unbounded until the process says otherwise,
                // and then bounded by the process without being redeclared.
                const unbounded = await wire.fetch('/__abide/rpc/demo/size/open', sized(big))
                is('an endpoint with no ceiling takes it', unbounded.status, 200)

                const off = onConfig(() => ({ ABIDE_MAX_REQUEST_BODY_SIZE: 16 }))
                try {
                    const floored = await wire.fetch('/__abide/rpc/demo/size/open', sized(big))
                    is('until the process declares one, at the door', floored.status, 413)
                } finally {
                    off()
                }
            },
        },

        {
            title: 'a call that stops making progress FAILS, and per chunk when it yields',
            note: 'This is the one knob that is armed on the DEFAULT path: `ABIDE_RPC_TIMEOUT` floors at 300000, so `limitOf()` never answers `NO_LIMIT` and every async handler is inside a `race` — a streaming one per chunk, a settling one once. It had no assertion anywhere, which is the shape CLAUDE.md’s "an option nothing passes" rule would have read as dead. The two arms fail with different words because they are different questions: a handler that never settles `did not settle`, and one that yielded twice and then stopped `stopped producing` — the second is what a whole-settle timeout cannot see, since a stream that keeps yielding forever settles never and is fine. The knob is read PER CALL and not at declaration, because a declaration runs at import and could not have seen `onConfig`; the third arm is what makes that ordering claim testable.',
            async run({ is }) {
                const stuck = GET(
                    async () => {
                        await sleep(200)
                        return 'never seen'
                    },
                    { timeout: 20 },
                )
                const stalls = GET(
                    async function* () {
                        yield 'a'
                        yield 'b'
                        await sleep(200)
                        yield 'c'
                    },
                    { timeout: 20 },
                )
                register(
                    'rpc',
                    [
                        ['demo/limit/stuck', 'stuck'],
                        ['demo/limit/stalls', 'stalls'],
                    ],
                    { stuck, stalls },
                )

                const remoteStuck = client<void, string>('demo/limit/stuck')
                let settleFailure: unknown
                try {
                    await remoteStuck()
                } catch (failure) {
                    settleFailure = failure
                }
                is(
                    'a handler that never settles fails',
                    remoteStuck().isError(settleFailure, 'AbideTimeoutError'),
                    true,
                )
                is('and says which half it was', String(settleFailure).includes('did not settle'), true)

                // The per-CHUNK arm: the first two land, so this is not a call that failed to start.
                const remoteStalls = client<void, string>('demo/limit/stalls', { stream: true })
                const landed: string[] = []
                let chunkFailure: unknown
                try {
                    for await (const chunk of remoteStalls()) landed.push(chunk)
                } catch (failure) {
                    chunkFailure = failure
                }
                is('the chunks before the stall arrived', landed, ['a', 'b'])
                is(
                    'and the stall between chunks is what failed',
                    remoteStalls().isError(chunkFailure, 'AbideTimeoutError'),
                    true,
                )
                is(
                    'with the other half of the wording',
                    String(chunkFailure).includes('stopped producing'),
                    true,
                )

                // The DOOR, not the declaration. This endpoint declares no timeout and the hook is
                // registered AFTER it, which is the ordering `declare` refuses to capture a limit
                // for — `limitOf()` is called per request precisely so a knob set later is honoured.
                const drifts = GET(async () => {
                    await sleep(200)
                    return 'never seen'
                })
                register('rpc', [['demo/limit/drifts', 'drifts']], { drifts })
                const remoteDrifts = client<void, string>('demo/limit/drifts')
                const off = onConfig(() => ({ ABIDE_RPC_TIMEOUT: 20 }))
                try {
                    let knobFailure: unknown
                    try {
                        await remoteDrifts()
                    } catch (failure) {
                        knobFailure = failure
                    }
                    is(
                        'a knob set after the declaration still reaches it',
                        remoteDrifts().isError(knobFailure, 'AbideTimeoutError'),
                        true,
                    )
                } finally {
                    off()
                }
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
        {
            title: 'a socket that has not received yet SIGNALS, so hydration keeps what the server wrote',
            note: 'A `channel` never loads, so its cold read hands back `undefined` and the slot paints empty — which on a client that has just adopted server markup blanks a value the server got right, warns, and fills it back in a round trip later. A `memo` in the same slot does not, because its pending read signals. A connection IS a load, so `remoteSocket` spells it as one and every catcher already knows what to do with it. The server is untouched: a `socket` is a `channel` with an address in front of it — `s()` selects the same stream `channel()` built — and a walk that waited on a channel which may never receive would wait forever.',
            async run({ is, host }) {
                // The server's half: a plain channel holding a value, rendered to markup.
                const served = channel<string>()
                served.publish('STATUS-OK')
                const markup = await renderToString(html`<p>${() => served()}</p>`, { hydrate: true })

                // The client's half, over a wire this case drives by hand.
                let live: Wire | null = null
                const feed = remoteSocket<string>('demo/status/feed', {
                    base: wire.base,
                    open: () => {
                        live = {
                            send: () => {},
                            close: () => {},
                            onmessage: null,
                            onopen: null,
                            onclose: null,
                        }
                        return live
                    },
                })

                const adopted = el('div')
                adopted.innerHTML = markup
                host.append(adopted)
                // The SELECT stays inside the thunk: the slot takes a source and reads it, so
                // `${() => feed()}` is the isomorphic spelling and `${() => room()}` would be a read.
                hydrate(adopted, () => html`<p>${() => feed()}</p>`)
                await tick()
                const room = feed()
                const text = () => (adopted.textContent ?? '').trim()

                is('the server’s value survived hydration', text(), 'STATUS-OK')
                is('…because the connection reads as a load', room.pending(), true)

                // Connected, but still nothing to show — the markup is still the best answer.
                ;(live as Wire | null)?.onopen?.()
                await tick()
                is('…and still survives an open with no message', text(), 'STATUS-OK')

                ;(live as Wire | null)?.onmessage?.({ data: JSON.stringify('STATUS-LIVE') })
                await tick()
                is('the first message is what repaints it', text(), 'STATUS-LIVE')
                is('…and the load is over', room.pending(), false)

                // A dropped wire is a reload in flight over a value still being served — the one
                // thing a subscriber could not otherwise ask, since after the first message a
                // healthy connection and a dead one read identically.
                is('a live wire is not refreshing', room.refreshing(), false)
                ;(live as Wire | null)?.onclose?.()
                await tick()
                is('a dropped one is', room.refreshing(), true)
                is('…while still serving the last message', text(), 'STATUS-LIVE')
                is('…and without going back to pending', room.pending(), false)

                feed.close()
                await tick()
                is('closing is not reconnecting', room.refreshing(), false)
            },
        },
    ],
})
