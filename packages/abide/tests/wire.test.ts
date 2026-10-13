// 16.2, 16.28, 16.29 AND 19.15 — A HANDLER OVER HTTP, END TO END. An app is built and served by the
// commands a host runs, and what is asserted is what crosses the wire: the address a handler answers
// at, what each outcome is answered with, what the browser's bundle was handed in place of the
// server module — and, through `wire` itself, that the browser's `Rpc` is the same value the server's
// is. Spawned for `serve.test.ts`'s reason: happy-dom's preload clobbers `Response`.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { paintedCallsLanded } from '#shared/takeEarlyCall.ts'
import { wire } from '#ui/wire.ts'
import {
    appFixture,
    buildApp,
    builtFiles,
    builtHandlers,
    serveApp,
} from './builtApp.ts'
import { disarmMuxes } from './disarmMuxes.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

// A STRING NO BROWSER MAY EVER RECEIVE. The handler module imports it, the page imports the
// handler, and the bundle is searched for it.
const SECRET = 'db-password-7f3a91'

const INVOICES = `import { GET, POST, refuse, request, response } from '@abide/abide/server'
import { SECRET } from '#src/server/database.ts'

const notYours = refuse.named('NotYours', 403, 'That invoice belongs to someone else.', {
    schema: (value: unknown) => value as { owner: string },
})

export const getInvoice = GET(async ({ id }: { id: string }) => {
    if (SECRET === '') return refuse(500)
    if (id === '4311') return notYours({ owner: 'Grace Hopper' })
    return { number: \`INV-\${id}\`, total: '$82.40' }
})

export const ping = GET(() => undefined)

export const broken = GET((): string => {
    throw new Error('the database is on fire')
})

export const payInvoice = POST(async ({ id, amount }: { id: string; amount: number }) => ({ id, paid: amount }))

export const created = POST(() => {
    response().status = 201
    response().headers.set('location', '/invoices/9')
    return { id: '9' }
})

export const whoAsked = GET(() => request().headers.get('x-caller'))

export const lines = GET(async function* () {
    yield 1
})

export const postLines = POST(async function* () {
    yield 1
})

async function* pairings(): AsyncGenerator<{ ready: boolean }> {
    yield { ready: true }
}

const provider: (() => void) & { pairings: typeof pairings } = Object.assign(() => {}, { pairings })

export const pairing = GET(provider.pairings)

export const arrowLines = GET(() => pairings())

export const awaitedLines = GET(async () => pairings())

export const pdf = GET(() => new Uint8Array([37, 80, 0, 255]))

export const view = GET(
    () => new DataView(new Uint8Array([7, 255]).buffer),
)

export const csv = GET(() => new Blob(['a,b\\n'], { type: 'text/csv' }))

let sendRest = (): void => {}
export const binaryRows = GET(async function* () {
    yield new Uint8Array([1, 2])
    await new Promise<void>((done) => {
        sendRest = done
    })
    yield new Uint8Array([255])
})

export const releaseRows = POST(() => {
    sendRest()
})
`

const PAGE = `<script>
import { reactive } from '@abide/abide'
import { getInvoice } from '#src/invoices/invoices.abide'

const invoice = reactive(() => getInvoice({ id: '4021' }))
</script>

<main><p id="total">{invoice().total}</p></main>`

let app = ''
let stop = (): void => {}
let base = ''

// 18.3 — EVERY `GET` THE WIRE LOADS IS FOLLOWED over the mux, and `followWire.test.ts` is where that
// is asserted. Here the socket never opens: happy-dom's `WebSocket` wraps `ws`, which throws an
// unhandled `error` for a host nobody listens on — which three of these tests' addresses are.
const unstubbedSocket = globalThis.WebSocket
globalThis.WebSocket = class {
    static OPEN = 1
    readyState = 0
    send(): void {}
    close(): void {}
} as unknown as typeof WebSocket
// The muxes this file opens are disarmed with it (`disarmMuxes`).
const disarm = disarmMuxes()
afterAll(() => {
    globalThis.WebSocket = unstubbedSocket
    disarm()
})

beforeAll(async () => {
    ;({ app, base, stop } = await serveApp({
        'page.abide': PAGE,
        'server/database.ts': `export const SECRET = '${SECRET}'\n`,
        'invoices/invoices.abide': `<script server>
${INVOICES}</script>
`,
        // Any file in a routes directory answers at that directory's route.
        'status.abide': `<script server>
import { GET } from '@abide/abide/server'\n\nexport const health = GET(() => ({ up: true }))\n</script>
`,
        'admin/admin.abide': `<script server>
import { GET } from '@abide/abide/server'\n\nexport const uptime = GET(() => ({ days: 41 }))\n</script>
`,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

const RPC = '/invoices'

// 16.2, 19.1 — the directory's route, then the export name; 16.30 and 21.3 on the answer.
test('a handler answers at its route and export name, as JSON — 16.2, 16.30', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/getInvoice?id=4021`)
    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toBe('application/json')
    expect(answer.headers.get('cache-control')).toBe('private, no-store')
    expect(await answer.json()).toEqual({ number: 'INV-4021', total: '$82.40' })

    const health = await Bun.fetch(`${base}/health`)
    expect(await health.json()).toEqual({ up: true })

    const uptime = await Bun.fetch(`${base}/admin/uptime`)
    expect(await uptime.json()).toEqual({ days: 41 })
})

// 16.40, 15.1 — the refusal the handler RETURNED, at its own status, as Problem Details (RFC 9457):
// its name the `type`, its message the `detail`, its data an extension member.
test('a refusal is answered at its own status with its name and data — 16.40', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/getInvoice?id=4311`)
    expect(answer.status).toBe(403)
    expect(answer.headers.get('content-type')).toBe('application/problem+json')
    expect(await answer.json()).toEqual({
        type: 'NotYours',
        title: 'NotYours',
        status: 403,
        detail: 'That invoice belongs to someone else.',
        data: { owner: 'Grace Hopper' },
    })
})

// 16.31, 16.41 — nothing is 204; a throw is 500 and says nothing about itself.
test('nothing is 204, and a throw is 500 with nothing of the error in it — 16.31, 16.41', async () => {
    expect((await Bun.fetch(`${base}${RPC}/ping`)).status).toBe(204)
    const broken = await Bun.fetch(`${base}${RPC}/broken`)
    expect(broken.status).toBe(500)
    const text = await broken.text()
    expect(text).not.toContain('on fire')
    expect(JSON.parse(text)).toMatchObject({
        type: 'about:blank',
        title: 'Internal Server Error',
    })
})

// 16.18, 16.20 — a mutation's args are its JSON body, and a body that is not one is a 400.
test('a mutation takes its args from the body, and refuses one that is not JSON — 16.18, 16.20', async () => {
    const paid = await Bun.fetch(`${base}${RPC}/payInvoice`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: '42', amount: 10 }),
    })
    expect(await paid.json()).toEqual({ id: '42', paid: 10 })
    const garbled = await Bun.fetch(`${base}${RPC}/payInvoice`, {
        method: 'POST',
        body: '{ not json',
    })
    expect(garbled.status).toBe(400)
})

// 15.7 — no handler at this address, or none for this method, is the one refusal.
test('an address nothing answers is NotFound, and a method nothing answers there is 405 — 15.7, 15.17', async () => {
    const nowhere = await Bun.fetch(`${base}${RPC}/nothingHere`)
    expect(nowhere.status).toBe(404)
    expect((await nowhere.json()).type).toBe('NotFound')
    const wrongMethod = await Bun.fetch(`${base}${RPC}/getInvoice`, {
        method: 'POST',
    })
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('allow')).toBe('GET, HEAD')
})

// 22.1, 22.9, 21.10 — a handler answers inside its request's scope: it reads the request, and what
// it writes through `response` is on the answer.
test('a handler reads its request and writes its response — 22.1, 22.9', async () => {
    const asked = await Bun.fetch(`${base}${RPC}/whoAsked`, {
        headers: { 'x-caller': 'ada' },
    })
    expect(await asked.json()).toBe('ada')
    const made = await Bun.fetch(`${base}${RPC}/created`, { method: 'POST' })
    expect(made.status).toBe(201)
    expect(made.headers.get('location')).toBe('/invoices/9')
})

// 16.28 — THE BROWSER GETS THE WRAPPER AND NOT THE MODULE. The handler module imports the secret,
// the page imports the handler, and the bundle carries the address and not the secret. THE REVERT:
// drop `fence` from `bundleClient`'s plugins; the server module is bundled as written and the
// secret is in the client — along with `@abide/abide/server` and everything it reaches.
test('the browser bundle carries the address and none of the server module — 16.28', async () => {
    const chunks = [
        ...new Bun.Glob('**/*.js').scanSync({ cwd: `${app}/.abide/client` }),
    ]
    let bundle = ''
    for (const chunk of chunks)
        bundle += await Bun.file(`${app}/.abide/client/${chunk}`).text()
    expect(bundle).not.toContain(SECRET)
    expect(bundle).toContain('../../invoices/getInvoice')
})

// 16.29 — ANYTHING ELSE UNDER `server/` IS A BUILD ERROR from the client graph, never a module the
// browser silently receives. THE REVERT: return `undefined` from the fence's `onLoad` for a path
// with no wrapper; the build succeeds and the database module is in the bundle.
test('a page importing server code that is not a handler does not build — 16.29', async () => {
    const leaking = appFixture({
        'page.abide': `<script>\nimport { SECRET } from '#src/server/database.ts'\n</script>\n\n<p>{SECRET}</p>`,
        'server/database.ts': `export const SECRET = '${SECRET}'\n`,
    })
    const built = await buildApp(leaking)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('RULEBOOK 16.29')
})

// 19.15 — a server block's export that is not declared as a handler is refused by name, rather
// than being an address that never answers.
test('an rpc module exporting something that is not a handler does not build — 19.15', async () => {
    const stray = appFixture({
        'page.abide': '<p>home</p>',
        'invoices/invoices.abide': `<script server>
import { GET } from '@abide/abide/server'\n\nexport const getInvoice = GET(() => 1)\nexport const TAX_RATE = 0.2\n</script>
`,
    })
    const built = await buildApp(stray)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('`TAX_RATE`')
    expect(built.stderr).toContain('RULEBOOK 19.15')
})

// 19.1 — two files in one directory exporting one name are one address, and a build error naming
// both. THE REVERT: drop `refuseSharedRoutes` from `emitApp`; the build succeeds.
test('two handlers at one address do not build, and both files are named — 19.1', async () => {
    const twice = appFixture({
        'page.abide': '<p>home</p>',
        'admin/reports.abide': `<script server>
import { GET } from '@abide/abide/server'\n\nexport const audit = GET(() => 1)\n</script>
`,
        'admin/logs.abide': `<script server>
import { GET } from '@abide/abide/server'\n\nexport const audit = GET(() => 2)\n</script>
`,
    })
    const built = await buildApp(twice)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('admin/reports.abide')
    expect(built.stderr).toContain('admin/logs.abide')
})

// 19.15 — WHAT DECLARES A HANDLER IS THE CALL, NOT THE SPELLING OF THE LINE IT STANDS ON. Every
// module below is a handler the language says is one — declared then exported, exported under
// another name, its method imported under another name or through a namespace, re-exported from a
// helper module, a default naming a binding — and none is written `export const x = GET(…)`.
// THE REVERT: read the method off the source with a pattern over that one spelling; the build is
// refused on the first of them.
test('a handler declared any way the language allows is mounted with its method — 19.15', async () => {
    const app = appFixture({
        'page.abide': '<p>home</p>',
        'server/shared.ts': `import { PATCH } from '@abide/abide/server'\n\nexport const touch = PATCH(() => 1)\n`,
        'later/later.abide': `<script server>
import { GET } from '@abide/abide/server'\n\nconst find = GET(() => 1)\nexport { find }\nexport { find as lookup }\n</script>
`,
        'renamed/renamed.abide': `<script server>
import { POST as post } from '@abide/abide/server'\n\nexport const save = post(() => 1)\n</script>
`,
        'spaced/spaced.abide': `<script server>
import * as abide from '@abide/abide/server'\n\nexport const replace = abide.PUT(() => 1)\n</script>
`,
        'passed/passed.abide': `<script server>
export { touch } from '#src/server/shared.ts'\n</script>
`,
        'named/named.abide': `<script server>
import { DELETE } from '@abide/abide/server'\n\nconst drop = DELETE(() => 1)\nexport const named = drop\nexport type Dropped = { id: string }\n</script>
`,
    })
    const built = await buildApp(app)
    expect(built.stderr).toBe('')
    expect(built.exitCode).toBe(0)
    const handlers = await builtHandlers(app)
    const methods: Record<string, string> = {}
    for (const handler of handlers) methods[handler.address] = handler.method
    expect(methods).toEqual({
        '/later/find': 'GET',
        '/later/lookup': 'GET',
        '/named/named': 'DELETE',
        '/passed/touch': 'PATCH',
        '/renamed/save': 'POST',
        '/spaced/replace': 'PUT',
    })
})

// 20.3, 38.62 — `clients: { cli: false }` IS READ OFF THE DECLARATION INTO THE TABLE THE BUILD WRITES,
// the only thing the shell holds of an app it may never have booted (38.7). THE REVERT: read
// `withheldFrom(call, 'ui')` for `cli` in `declaringMethod`; `internal` reads `cli: true`, and the shell
// lists it. 16.37 — AND ONE TYPED AS RETURNING A `Response` IS WRITTEN WITHHELD unless its `clients`
// puts it back. THE REVERT: default `cli` to true in `declaringMethod`; `raw` reads `cli: true`.
test('a handler with clients.cli false, or returning a Response, is written to the table withheld from the shell — 16.37, 20.3, 38.62', async () => {
    const app = appFixture({
        'page.abide': '<p>home</p>',
        'staff/staff.abide': `<script server>
import { GET } from '@abide/abide/server'\n\nexport const internal = GET(() => 'staff only', { clients: { cli: false } })\n\nexport const open = GET(() => 'anyone')\n\nexport const raw = GET(async () => new Response('bytes'))\n\nexport const shown = GET(() => new Response('{}'), { clients: { cli: true } })\n</script>
`,
    })
    const built = await buildApp(app)
    expect(built.stderr).toBe('')
    expect(built.exitCode).toBe(0)
    const handlers = await builtHandlers(app)
    const listed: Record<string, boolean> = {}
    for (const handler of handlers) listed[handler.address] = handler.cli
    expect(listed).toEqual({
        '/staff/internal': false,
        '/staff/open': true,
        '/staff/raw': false,
        '/staff/shown': true,
    })
})

// 19.15 — AND A CALL NAMED `GET` THAT IS NOT abide's IS NOT A HANDLER. THE REVERT: accept the
// export by the callee's spelling; this builds, and mounts a plain number as a handler.
test('an export calling a GET that is not abide’s does not build — 19.15', async () => {
    const app = appFixture({
        'page.abide': '<p>home</p>',
        'fake/fake.abide': `<script server>
const GET = (value: () => number) => value()\n\nexport const count = GET(() => 1)\n</script>
`,
    })
    const built = await buildApp(app)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('`count`')
    expect(built.stderr).toContain('RULEBOOK 19.15')
})

// THE BROWSER'S `Rpc`, against the served handler. `wire` is what a generated wrapper calls, so this
// is the value a page holds: it answers with the handler's value, it joins a standing call with the
// same args (1.8), a refusal narrows by name (16.8), and a mutation calls again (16.7). The wire is
// counted, because a call that re-fetched would still answer right.
test('the wire is the same Rpc: coalesced, narrowable, and a mutation calls again — 16.4, 16.28', async () => {
    const calls: string[] = []
    const window = globalThis as { fetch: typeof fetch }
    const previous = window.fetch
    window.fetch = ((input: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${new URL(input).pathname}`)
        return Bun.fetch(input, init)
    }) as typeof fetch
    try {
        const getInvoice = wire('GET', `${base}${RPC}/getInvoice`) as (args: {
            id: string
        }) => PromiseLike<unknown> & {
            error(): unknown
            catch(onFailed: () => void): Promise<unknown>
        }
        const first = getInvoice({ id: '4021' })
        expect(getInvoice({ id: '4021' })).toBe(first)
        expect(await first).toEqual({ number: 'INV-4021', total: '$82.40' })
        expect(calls).toEqual([`GET ${RPC}/getInvoice`])

        const refused = getInvoice({ id: '4311' })
        await refused.catch(() => {})
        const narrowing = getInvoice as unknown as {
            isError(error: unknown, name: string): boolean
        }
        expect(narrowing.isError(refused.error(), 'NotYours')).toBe(true)
        expect((refused.error() as { data: unknown }).data).toEqual({
            owner: 'Grace Hopper',
        })

        calls.length = 0
        const pay = wire('POST', `${base}${RPC}/payInvoice`) as (args: {
            id: string
            amount: number
        }) => PromiseLike<unknown>
        expect(await pay({ id: '42', amount: 10 })).toEqual({
            id: '42',
            paid: 10,
        })
        await new Promise((done) => setTimeout(done, 0))
        await pay({ id: '42', amount: 10 })
        expect(calls).toEqual([
            `POST ${RPC}/payInvoice`,
            `POST ${RPC}/payInvoice`,
        ])
    } finally {
        window.fetch = previous
    }
})

// 41.21 — A CALL THE PAGE ALREADY STARTED IS TAKEN, ONCE. Asserted by what reached `fetch`, because a
// wire that fetched again would answer the same invoice. THE REVERT: skip the `EARLY_CALLS` lookup
// in `wire`; the first reach fetches — one call where none is due — and lands a turn later.
test('the wire takes a call the page already started, and fetches after that — 41.21, 41.27', async () => {
    const fetched: string[] = []
    const window = globalThis as unknown as Record<string, unknown>
    const previous = window.fetch
    window.fetch = (async (input: string) => {
        fetched.push(input)
        return {
            status: 200,
            statusText: 'OK',
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () => '{"id":"7","fresh":true}',
        }
    }) as unknown
    let arrive = (): void => {}
    const later = {
        promise: new Promise<void>((done) => {
            arrive = done
        }),
        status: undefined as number | undefined,
        statusText: undefined as string | undefined,
        text: undefined as string | undefined,
        failed: false,
    }
    window.__abideCalls = {
        // Answered before the bundle ran, and painted settled (41.25).
        'GET /rpc/getInvoice?id=7 ': {
            promise: Promise.resolve(),
            status: 200,
            statusText: 'OK',
            text: '{"id":"7"}',
            failed: false,
            painted: 1,
        },
        // Answered before the bundle ran, and painted in flight.
        'GET /rpc/getInvoice?id=9 ': {
            promise: Promise.resolve(),
            status: 200,
            statusText: 'OK',
            text: '{"id":"9"}',
            failed: false,
        },
        // Still on its way.
        'GET /rpc/getInvoice?id=8 ': later,
    }
    try {
        const getInvoice = wire('GET', '/rpc/getInvoice') as (args: {
            id: string
        }) => (() => unknown) & {
            ready(): boolean
            refresh(): void
        } & PromiseLike<unknown>
        // Arrived: the value lands in the same run, with nothing fetched.
        const arrived = getInvoice({ id: '7' })
        expect(arrived.ready()).toBe(true)
        expect(arrived()).toEqual({ id: '7' })

        // 41.25 — painted in flight: in flight at adopt, however early its answer arrived, and
        // landed from what arrived. THE REVERT: settle every arrived answer at once; this reads
        // `ready()` true here.
        const painted = getInvoice({ id: '9' })
        expect(painted.ready()).toBe(false)
        expect(await painted).toEqual({ id: '9' })

        // In flight: waited on, not sent twice.
        const waiting = getInvoice({ id: '8' })
        later.status = 200
        later.statusText = 'OK'
        later.text = '{"id":"8"}'
        arrive()
        expect(await waiting).toEqual({ id: '8' })
        expect(fetched).toEqual([])

        // Taken once: a refresh is a call of its own.
        arrived.refresh()
        await new Promise((done) => setTimeout(done, 0))
        expect(fetched).toEqual(['/rpc/getInvoice?id=7'])
    } finally {
        window.fetch = previous
        window.__abideCalls = undefined
    }
})

// 16.32 — A FRAMED STREAM IS THE CHUNKS IT CARRIED, in each framing the server can answer in. THE
// REVERT: drop the jsonl arm from `answered`; the body is not one JSON value, and the call refuses.
test('the wire collects a jsonl or sse answer into its chunks — 16.32', async () => {
    const window = globalThis as unknown as Record<string, unknown>
    const previous = window.fetch
    const bodies: Record<string, [string, string]> = {
        '/rpc/lines': ['application/jsonl', '{"n":1}\n{"n":2}\n'],
        '/rpc/events': ['text/event-stream', 'data: 1\n\ndata: 2\n\n'],
    }
    window.fetch = (async (input: string) => {
        const [type, text] = bodies[input] as [string, string]
        return {
            status: 200,
            statusText: 'OK',
            headers: new Headers({ 'content-type': type }),
            text: async () => text,
        }
    }) as unknown
    try {
        const lines = wire('GET', '/rpc/lines') as () => PromiseLike<unknown>
        const events = wire('GET', '/rpc/events') as () => PromiseLike<unknown>
        expect(await lines()).toEqual([{ n: 1 }, { n: 2 }])
        expect(await events()).toEqual([1, 2])
    } finally {
        window.fetch = previous
    }
})

// 16.32 — A STREAMING HANDLER'S COPY TAKES EACH CHUNK AS ITS LINE ARRIVES. The answer's second line
// is not sent until the copy has shown the first, so a copy that collected would show nothing at
// all and the race reports it. No clock is read: the order is the claim.
//
// THE REVERT: declare `body` rather than `streamed` for a marked copy in `wire`; the first read loses
// the race, and the value lands once, whole, when the answer closes.
test('a copy the build marked as streaming holds each chunk as it lands — 16.32', async () => {
    const window = globalThis as unknown as Record<string, unknown>
    const previous = window.fetch
    let send = (_line: string): void => {}
    let close = (): void => {}
    window.fetch = (async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/jsonl' }),
        body: new ReadableStream<Uint8Array>({
            start(controller) {
                const encoder = new TextEncoder()
                send = (line) => controller.enqueue(encoder.encode(line))
                close = () => controller.close()
            },
        }),
        text: async () => {
            throw new Error('a streamed answer is not read to its end')
        },
    })) as unknown
    try {
        const rows = (
            wire('GET', '/rpc/rows', {
                stream: true,
            }) as () => (() => unknown) & {
                ready(): boolean
                busy(): boolean
            } & PromiseLike<unknown>
        )()
        send('{"n":1}\n{"n"')
        const landed = await Promise.race([
            (async () => {
                while (!rows.ready())
                    await new Promise((done) => setTimeout(done, 0))
                return rows()
            })(),
            Bun.sleep(2000).then(() => 'nothing before the answer closed'),
        ])
        expect(landed).toEqual([{ n: 1 }])
        expect(rows.busy()).toBe(true)
        // The second line, split across two reads, is one chunk.
        send(':2}\n')
        close()
        expect(await rows).toEqual([{ n: 1 }, { n: 2 }])
    } finally {
        window.fetch = previous
    }
})

// 16.7 AND 1.8 — A MUTATION'S STREAM COALESCES UNTIL IT IS DONE. A call while the stream is open joins
// it — the same value, no second request — and one after the close is a new write. THE REVERT: hand
// `declare` a `reactive` of a marked mutation's body in `wire`, as a `GET`'s is; it carries no `ttl`
// of 0, and the call after the close is served the first stream's chunks without a request.
test('a streaming mutation coalesces until its stream closes, then calls again — 16.7, 1.8', async () => {
    const window = globalThis as unknown as Record<string, unknown>
    const previous = window.fetch
    let fetches = 0
    let close = (): void => {}
    window.fetch = (async () => {
        fetches += 1
        return {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers({ 'content-type': 'application/jsonl' }),
            body: new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('{"n":1}\n'))
                    close = () => controller.close()
                },
            }),
        }
    }) as unknown
    try {
        const send = wire('POST', '/rpc/send', {
            stream: true,
        }) as () => PromiseLike<unknown> & { busy(): boolean }
        const first = send()
        await new Promise((done) => setTimeout(done, 0))
        expect(first.busy()).toBe(true)
        expect(send()).toBe(first)
        expect(fetches).toBe(1)
        close()
        expect(await first).toEqual([{ n: 1 }])
        await new Promise((done) => setTimeout(done, 0))
        const second = send()
        close()
        expect(await second).toEqual([{ n: 1 }])
        expect(fetches).toBe(2)
    } finally {
        window.fetch = previous
    }
})

// 16.32 — AND THE BUILD IS WHAT MARKS IT: a handler returning an async generator is written into the
// browser's wrapper as a stream, and one that does not is left a value — a mutation's as much as a
// read's, and an arrow handing one back or a promise of one, or a member naming one
// (`claudeCode.bridge`), as much as one declared `async function*`. THE REVERT: return false from
// `returnsGenerator`; no wrapper carries `stream` and every copy collects. Put back
// `method.name === 'GET'` and `postLines` loses it; drop its `Promise` unwrap and `awaitedLines` does.
test('the build marks a handler returning an async generator as a stream in its wrapper — 16.32', async () => {
    const wrapper =
        (await builtFiles(app))['invoices/invoices.abide']?.client ?? ''
    const lineOf = (name: string): string =>
        wrapper.split('\n').find((line) => line.includes(`const ${name} =`)) ??
        ''
    expect(lineOf('lines')).toContain('{"stream":true}')
    expect(lineOf('postLines')).toContain('{"stream":true}')
    expect(lineOf('pairing')).toContain('{"stream":true}')
    expect(lineOf('arrowLines')).toContain('{"stream":true}')
    expect(lineOf('awaitedLines')).toContain('{"stream":true}')
    expect(lineOf('getInvoice')).not.toContain('stream')
})

// 20.4 — A HANDLER WITHHELD FROM THE UI GETS NO WRAPPER, so a page importing it is 16.29's compile
// error rather than a call the browser was quietly handed; the handler still answers over http. THE
// REVERT: write a wrapper for every mount in `wrappersOf`; the build succeeds and the page ships a call
// to a handler its author withheld.
test('a handler with clients.ui false gets no browser wrapper — 20.4', async () => {
    const HANDLERS = `import { GET } from '@abide/abide/server'

export const internal = GET(() => 'staff only', { clients: { ui: false } })

export const open = GET(() => 'anyone')
`
    const refused = appFixture({
        'page.abide': `<script>
import { reactive } from '@abide/abide'
import { internal } from '#src/staff/staff.abide'

const value = reactive(() => internal())
</script>

<p>{value()}</p>`,
        'staff/staff.abide': `<script server>
${HANDLERS}</script>
`,
    })
    const built = await buildApp(refused)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('internal')

    const allowed = appFixture({
        'page.abide': `<script>
import { reactive } from '@abide/abide'
import { open } from '#src/staff/staff.abide'

const value = reactive(() => open())
</script>

<p>{value()}</p>`,
        'staff/staff.abide': `<script server>
${HANDLERS}</script>
`,
    })
    expect((await buildApp(allowed)).exitCode).toBe(0)
})

// 41.25 — HYDRATION WAITS ON A CALL PAINTED SETTLED THAT HAS NOT ANSWERED, and on nothing else: not
// one painted in flight, and not one already answered. A call whose request FAILED settles the
// early-call script's promise with no text, and that ends the wait as an answer does. THE REVERT:
// drop the `painted` test in `paintedCallsLanded`; the call painted in flight is waited on
// too, and this reports the wait still open after the failure.
test('hydration waits on the calls painted settled, and a failed one ends the wait — 41.25', async () => {
    const window = globalThis as unknown as Record<string, unknown>
    const pending = () => {
        let settle = (): void => {}
        const promise = new Promise<void>((done) => {
            settle = done
        })
        return { promise, settle }
    }
    const painted = pending()
    const inFlight = pending()
    window.__abideCalls = {
        painted: { promise: painted.promise, text: undefined, painted: 1 },
        'in flight': { promise: inFlight.promise, text: undefined },
        answered: { promise: Promise.resolve(), text: '{}', painted: 1 },
    }
    try {
        let ended = false
        paintedCallsLanded()?.then(() => {
            ended = true
        })
        await new Promise((done) => setTimeout(done, 0))
        expect(ended).toBe(false)
        // The request failed: the promise settles and no text was ever set.
        painted.settle()
        await new Promise((done) => setTimeout(done, 0))
        expect(ended).toBe(true)

        window.__abideCalls = {
            'in flight': { promise: inFlight.promise, text: undefined },
        }
        expect(paintedCallsLanded()).toBeUndefined()
    } finally {
        delete window.__abideCalls
    }
})

// 16.34 — A BINARY DECODES BACK TO THE BYTES IT WAS, at `application/octet-stream` and at a `Blob`'s
// own type alike. `0xff` is no UTF-8, so a body read as text cannot hand these bytes back. THE
// REVERT: read every answer as text in `answerOf`'s `fetched` (drop the `bytes` arm); the call
// settles `undefined`, the body being no JSON.
test('a binary answer decodes back to a Uint8Array in the browser — 16.34', async () => {
    const window = globalThis as { fetch: typeof fetch }
    const previous = window.fetch
    window.fetch = ((input: string, init?: RequestInit) =>
        Bun.fetch(input, init)) as typeof fetch
    try {
        const pdf = wire(
            'GET',
            `${base}${RPC}/pdf`,
        ) as () => PromiseLike<unknown>
        const decoded = await pdf()
        expect(decoded).toBeInstanceOf(Uint8Array)
        expect([...(decoded as Uint8Array)]).toEqual([37, 80, 0, 255])
        const csv = wire(
            'GET',
            `${base}${RPC}/csv`,
        ) as () => PromiseLike<unknown>
        expect(new TextDecoder().decode((await csv()) as Uint8Array)).toBe(
            'a,b\n',
        )
        // A `DataView` is a binary too. THE REVERT: test `instanceof Uint8Array` alone in
        // `answerValue`; the view goes out as JSON `{}` and settles as an empty record.
        const view = wire(
            'GET',
            `${base}${RPC}/view`,
        ) as () => PromiseLike<unknown>
        expect([...((await view()) as Uint8Array)]).toEqual([7, 255])
    } finally {
        window.fetch = previous
    }
})

// 16.3, 16.46 — A STREAM OF BINARY CHUNKS IS A STREAM OF BYTES TO ITS READER, each read landing as it
// arrives: the handler holds its second chunk until the first has landed in the copy, so a copy that
// collected shows nothing before the race ends. THE REVERT: leave `binary` out of `fetched`'s
// `unread` in `answerOf`; the body is read to its end, which waits on a chunk the handler holds
// back until the first has landed, and the race reports nothing landed.
test('a streaming copy over binary chunks holds each as a Uint8Array as it lands — 16.3, 16.46', async () => {
    const window = globalThis as { fetch: typeof fetch }
    const previous = window.fetch
    window.fetch = ((input: string, init?: RequestInit) =>
        Bun.fetch(input, init)) as typeof fetch
    try {
        const rows = (
            wire('GET', `${base}${RPC}/binaryRows`, {
                stream: true,
            }) as () => (() => unknown) & {
                ready(): boolean
            } & PromiseLike<unknown>
        )()
        const landed = await Promise.race([
            (async () => {
                while (!rows.ready())
                    await new Promise((done) => setTimeout(done, 5))
                return rows()
            })(),
            Bun.sleep(5000).then(() => 'nothing before the answer closed'),
        ])
        expect(landed).toEqual([new Uint8Array([1, 2])])
        await Bun.fetch(`${base}${RPC}/releaseRows`, {
            method: 'POST',
            headers: { origin: base },
        })
        const chunks = (await rows) as Uint8Array[]
        const bytes: number[] = []
        for (const chunk of chunks) {
            expect(chunk).toBeInstanceOf(Uint8Array)
            bytes.push(...chunk)
        }
        expect(bytes).toEqual([1, 2, 255])
    } finally {
        window.fetch = previous
    }
})
