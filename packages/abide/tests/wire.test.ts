// 16.2, 16.28, 16.29 AND 16.73 — A HANDLER OVER HTTP, END TO END. An app is built and served by the
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
    builtCompilation,
    builtHandlers,
    serveApp,
} from './builtApp.ts'
import { disarmMuxes } from './disarmMuxes.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

// A STRING NO BROWSER MAY EVER RECEIVE. The handler module imports it, the page imports the
// handler, and the bundle is searched for it.
const SECRET = 'db-password-7f3a91'

// One handler file per address the tests call (16.2, 23.14), and what two of them share — a
// refusal, a generator, a latch — in a module under `lib/`, which has no address (23.15).
const SERVER = `import { GET, POST, refuse, request, response } from '@abide/abide/server'\n`

const INVOICES: Record<string, string> = {
    'invoices/lib/shared.ts': `import { refuse } from '@abide/abide/server'

export const notYours = refuse.named('NotYours', 403, 'That invoice belongs to someone else.', {
    schema: (value: unknown) => value as { owner: string },
})

export async function* pairings(): AsyncGenerator<{ ready: boolean }> {
    yield { ready: true }
}

export const provider: (() => void) & { pairings: typeof pairings } = Object.assign(() => {}, { pairings })

export const latch = { sendRest: (): void => {} }
`,
    'invoices/getInvoice.handler.ts': `${SERVER}import { SECRET } from '#src/lib/database.server.ts'
import { notYours } from './lib/shared.ts'

export default GET(async ({ id }: { id: string }) => {
    if (SECRET === '') return refuse(500)
    if (id === '4311') return notYours({ owner: 'Grace Hopper' })
    return { number: \`INV-\${id}\`, total: '$82.40' }
})
`,
    'invoices/ping.handler.ts': `${SERVER}export default GET(() => undefined)\n`,
    'invoices/broken.handler.ts': `${SERVER}export default GET((): string => {
    throw new Error('the database is on fire')
})
`,
    'invoices/payInvoice.handler.ts': `${SERVER}export default POST(async ({ id, amount }: { id: string; amount: number }) => ({ id, paid: amount }))\n`,
    'invoices/created.handler.ts': `${SERVER}export default POST(() => {
    response().status = 201
    response().headers.set('location', '/invoices/9')
    return { id: '9' }
})
`,
    'invoices/whoAsked.handler.ts': `${SERVER}export default GET(() => request().headers.get('x-caller'))\n`,
    'invoices/lines.handler.ts': `${SERVER}export default GET(async function* () {
    yield 1
})
`,
    'invoices/postLines.handler.ts': `${SERVER}export default POST(async function* () {
    yield 1
})
`,
    'invoices/pairing.handler.ts': `${SERVER}import { provider } from './lib/shared.ts'

export default GET(provider.pairings)
`,
    'invoices/arrowLines.handler.ts': `${SERVER}import { pairings } from './lib/shared.ts'

export default GET(() => pairings())
`,
    'invoices/awaitedLines.handler.ts': `${SERVER}import { pairings } from './lib/shared.ts'

export default GET(async () => pairings())
`,
    'invoices/pdf.handler.ts': `${SERVER}export default GET(() => new Uint8Array([37, 80, 0, 255]))\n`,
    'invoices/view.handler.ts': `${SERVER}export default GET(
    () => new DataView(new Uint8Array([7, 255]).buffer),
)
`,
    'invoices/csv.handler.ts': `${SERVER}export default GET(() => new Blob(['a,b\\n'], { type: 'text/csv' }))\n`,
    'invoices/binaryRows.handler.ts': `${SERVER}import { latch } from './lib/shared.ts'

export default GET(async function* () {
    yield new Uint8Array([1, 2])
    await new Promise<void>((done) => {
        latch.sendRest = done
    })
    yield new Uint8Array([255])
})
`,
    'invoices/releaseRows.handler.ts': `${SERVER}import { latch } from './lib/shared.ts'

export default POST(() => {
    latch.sendRest()
})
`,
}

const PAGE = `<script>
import { reactive } from '@abide/abide'
import getInvoice from '#src/invoices/getInvoice.handler.ts'

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
        'index.abide': PAGE,
        'lib/database.server.ts': `export const SECRET = '${SECRET}'\n`,
        ...INVOICES,
        // A handler file answers at its own path (23.14), at the root as anywhere.
        'health.handler.ts': `import { GET } from '@abide/abide/server'\n\nexport default GET(() => ({ up: true }))\n`,
        'admin/uptime.handler.ts': `import { GET } from '@abide/abide/server'\n\nexport default GET(() => ({ days: 41 }))\n`,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

const RPC = '/invoices'

// 16.2, 23.14 — a handler file answers at its own path; 16.30 and 21.3 on the answer.
test('a handler file answers at its path, as JSON — 16.2, 16.30', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/getInvoice?id=4021`)
    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toBe('application/json')
    // 21.22 — the fixture is served built, where the worker is registered.
    expect(answer.headers.get('cache-control')).toBe(
        'private, stale-while-revalidate=604800, stale-if-error=31536000',
    )
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

// Every chunk of the browser's bundle, as one text.
async function clientBundle(): Promise<string> {
    let bundle = ''
    for (const chunk of new Bun.Glob('**/*.js').scanSync({
        cwd: `${app}/.abide/client`,
    }))
        bundle += await Bun.file(`${app}/.abide/client/${chunk}`).text()
    return bundle
}

// 16.28 — THE BROWSER GETS THE WRAPPER AND NOT THE MODULE. The handler file imports the secret,
// the page imports the handler file, and the bundle carries the address and not the secret. THE
// REVERT: answer the browser the file's own text in `abideModules`' handler-namespace `onLoad`; the
// handler file is bundled as written, and its import of a server file is 16.29's build error.
test('the browser bundle carries the address and none of the server module — 16.28', async () => {
    const bundle = await clientBundle()
    expect(bundle).not.toContain(SECRET)
    expect(bundle).toContain('../../invoices/getInvoice')
})

// 16.74 — A PAGE IMPORTING A HANDLER FILE IS HANDED THE WRAPPER AS THAT FILE'S DEFAULT: the face the
// build wrote for `invoices/getInvoice.handler.ts` is one `export default __wire(…)` and none of the file —
// not its secret, not the refusal its body names — the bundle carries the same, the server's render
// ran the handler itself, and the wrapper's call answers over the wire. THE REVERT: return the
// file's text rather than `face.client` for the browser in `abideModules`' handler-namespace
// `onLoad`; the handler file is bundled as written, and its import of a server file fails the build that
// every test here is served from (16.29).
test('a page importing a handler file holds its wrapper, and the call answers — 16.74', async () => {
    const { handlers } = await builtCompilation(app)
    const face = handlers['invoices/getInvoice.handler.ts']?.client ?? ''
    expect(face).toContain('export default __wire("GET"')
    expect(face).not.toContain('refuse')
    const bundle = await clientBundle()
    expect(bundle).not.toContain('That invoice belongs to someone else.')
    expect(bundle).not.toContain(SECRET)
    expect(await (await Bun.fetch(`${base}/`)).text()).toContain('$82.40')
    const window = globalThis as { fetch: typeof fetch }
    const previous = window.fetch
    window.fetch = ((input: string, init?: RequestInit) =>
        Bun.fetch(input, init)) as typeof fetch
    try {
        const getInvoice = wire('GET', `${base}${RPC}/getInvoice`) as (args: {
            id: string
        }) => PromiseLike<unknown>
        expect(await getInvoice({ id: '7' })).toEqual({
            number: 'INV-7',
            total: '$82.40',
        })
    } finally {
        window.fetch = previous
    }
})

// 16.29 — ANY OTHER SERVER FILE IS A BUILD ERROR from the client graph, never a module the
// browser silently receives. THE REVERT: return `undefined` from the fence's `onLoad` for a path
// with no wrapper; the build succeeds and the database module is in the bundle.
test('a page importing server code that is not a handler does not build — 16.29', async () => {
    const leaking = appFixture({
        'index.abide': `<script>\nimport { SECRET } from '#src/lib/database.server.ts'\n</script>\n\n<p>{SECRET}</p>`,
        'lib/database.server.ts': `export const SECRET = '${SECRET}'\n`,
    })
    const built = await buildApp(leaking)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('RULEBOOK 16.29')
})

// 16.73 — A HANDLER FILE EXPORTS ITS HANDLER AS ITS DEFAULT AND NOTHING ELSE: a second name is
// refused by name and file, rather than being a value nothing can reach. THE REVERT: skip the
// `each.name !== 'default'` refusal in `handlersUnder`; the build succeeds and `TAX_RATE` is dropped.
test('a handler file exporting a second name does not build, naming the file — 16.73', async () => {
    const stray = appFixture({
        'index.abide': '<p>home</p>',
        'invoices/getInvoice.handler.ts': `import { GET } from '@abide/abide/server'\n\nexport default GET(() => 1)\nexport const TAX_RATE = 0.2\n`,
    })
    const built = await buildApp(stray)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('invoices/getInvoice.handler.ts exports `TAX_RATE`')
    expect(built.stderr).toContain('RULEBOOK 16.73')
})

// 34.17 — AND A `.abide` EXPORTS NOTHING, from any block: a handler another file calls is a handler
// file. THE REVERT: let `export` through in `parseAbide`'s server block; the build succeeds and
// `getInvoice` is an export nothing mounts.
test('a .abide exporting from its server block does not build — 34.17', async () => {
    const exported = appFixture({
        'invoices/index.abide': `<script server>
import { GET } from '@abide/abide/server'\n\nexport const getInvoice = GET(() => 1)\n</script>
<p>invoices</p>
`,
    })
    const built = await buildApp(exported)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('RULEBOOK 34.17')
})

// 19.1 — a page and a handler file answering GET at one route are a build error naming both. THE
// REVERT: drop `refuseSharedRoutes` from `compileApp`; the build succeeds.
test('two files answering one route do not build, and both files are named — 19.1', async () => {
    const twice = appFixture({
        'index.abide': '<p>home</p>',
        'admin/audit.abide': '<p>audit</p>',
        'admin/audit.handler.ts': `import { GET } from '@abide/abide/server'\n\nexport default GET(() => 1)\n`,
    })
    const built = await buildApp(twice)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('admin/audit.abide')
    expect(built.stderr).toContain('admin/audit.handler.ts')
})

// 16.73 — WHAT DECLARES A HANDLER IS THE CALL, NOT THE SPELLING OF THE LINE IT STANDS ON. Every
// default below is a handler the language says is one — declared then exported, exported under
// `default` by name, its method imported under another name or through a namespace, re-exported
// from a helper module, beside a type — and none is written `export default GET(…)`. THE REVERT:
// read the method off the source with a pattern over that one spelling; the build is refused on the
// first of them.
test('a handler declared any way the language allows is mounted with its method — 16.73', async () => {
    const app = appFixture({
        'index.abide': '<p>home</p>',
        'lib/shared.ts': `import { PATCH } from '@abide/abide/server'\n\nexport const touch = PATCH(() => 1)\n`,
        'later/find.handler.ts': `import { GET } from '@abide/abide/server'\n\nconst find = GET(() => 1)\nexport default find\n`,
        'later/lookup.handler.ts': `import { GET } from '@abide/abide/server'\n\nconst find = GET(() => 1)\nexport { find as default }\n`,
        'renamed/save.handler.ts': `import { POST as post } from '@abide/abide/server'\n\nexport default post(() => 1)\n`,
        'spaced/replace.handler.ts': `import * as abide from '@abide/abide/server'\n\nexport default abide.PUT(() => 1)\n`,
        'passed/touch.handler.ts': `export { touch as default } from '#src/lib/shared.ts'\n`,
        'named/named.handler.ts': `import { DELETE } from '@abide/abide/server'\n\nconst drop = DELETE(() => 1)\nexport default drop\nexport type Dropped = { id: string }\n`,
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
        'index.abide': '<p>home</p>',
        'staff/internal.handler.ts': `import { GET } from '@abide/abide/server'\n\nexport default GET(() => 'staff only', { clients: { cli: false } })\n`,
        'staff/open.handler.ts': `import { GET } from '@abide/abide/server'\n\nexport default GET(() => 'anyone')\n`,
        'staff/raw.handler.ts': `import { GET } from '@abide/abide/server'\n\nexport default GET(async () => new Response('bytes'))\n`,
        'staff/shown.handler.ts': `import { GET } from '@abide/abide/server'\n\nexport default GET(() => new Response('{}'), { clients: { cli: true } })\n`,
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

// 16.73 — AND A DEFAULT CALLING A `GET` THAT IS NOT abide's IS NOT A HANDLER, and the refusal names
// the file. THE REVERT: accept the export by the callee's spelling in `declaredExports`; this builds,
// and mounts a plain number as a handler.
test('a handler file whose default is not a handler does not build, naming the file — 16.73', async () => {
    const app = appFixture({
        'index.abide': '<p>home</p>',
        'fake/count.handler.ts': `const GET = (value: () => number) => value()\n\nexport default GET(() => 1)\n`,
    })
    const built = await buildApp(app)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain(
        "fake/count.handler.ts's default export is not declared as a handler",
    )
    expect(built.stderr).toContain('RULEBOOK 16.73')
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
    const json = (text: string) =>
        new Response(text, { headers: { 'content-type': 'application/json' } })
    let arrive = (): void => {}
    const later = {
        promise: new Promise<void>((done) => {
            arrive = done
        }),
        painted: undefined,
        response: undefined as Response | undefined,
        bytes: undefined,
    }
    window.__abideCalls = {
        // Answered before the bundle ran, and painted settled (41.25): its body read to the end.
        'GET /rpc/getInvoice?id=7 ': {
            promise: Promise.resolve(),
            painted: 1,
            response: json(''),
            bytes: new TextEncoder().encode('{"id":"7"}').buffer,
        },
        // Answered before the bundle ran, and painted in flight.
        'GET /rpc/getInvoice?id=9 ': {
            promise: Promise.resolve(),
            painted: undefined,
            response: json('{"id":"9"}'),
            bytes: undefined,
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
        later.response = json('{"id":"8"}')
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

// 16.80 — A COPY'S FIRST LOAD MAY BE ANSWERED BY A KEPT COPY, every load after it asks past every
// cache: what it asks once it holds an answer is asked because it was refreshed, invalidated or went
// stale, and a cache below would hand back what it was dropping. A first load that got no answer
// is still a first load. And only where the worker answers the page: anywhere else the cache below
// is the browser's, which holds 21.22's answers a week past stale and marks none as kept. THE
// REVERT: drop the `answeredOnce.has` test from `requestOf` in `wire`; the refresh and the read
// after invalidate are asked `force-cache`. Drop the `controller` test; with no worker the first
// load is asked `force-cache`.
test('a GET is sent force-cache until the page has an answer for its args, no-cache after, and no-cache with no worker — 16.80', async () => {
    const asked: string[] = []
    let online = false
    const window = globalThis as unknown as Record<string, unknown>
    const previous = window.fetch
    window.fetch = (async (input: string, init?: RequestInit) => {
        asked.push(`${init?.cache} ${new URL(input, 'http://x').search}`)
        if (!online) throw new TypeError('Failed to fetch')
        return new Response('{"id":"1"}', {
            headers: { 'content-type': 'application/json' },
        })
    }) as unknown
    const worker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')
    const controlled = (controller: object | null) =>
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: { controller },
        })
    try {
        controlled({})
        const getInvoice = wire('GET', '/rpc/getInvoice') as (args: {
            id: string
        }) => PromiseLike<unknown> & {
            refresh(): void
            invalidate(): void
            catch(onFailed: () => void): Promise<unknown>
        }
        const turn = () => new Promise((done) => setTimeout(done, 0))
        await getInvoice({ id: '1' }).catch(() => {})
        online = true
        asked.push('online')
        getInvoice({ id: '1' }).refresh()
        await turn()
        getInvoice({ id: '1' }).refresh()
        await turn()
        getInvoice({ id: '1' }).invalidate()
        await getInvoice({ id: '1' })
        await getInvoice({ id: '2' })
        controlled(null)
        await getInvoice({ id: '3' })
        // However many loads reached the copy before one was answered — a call reaching a refused
        // value starts its own beside the refresh — each was a first load.
        const answered = asked.indexOf('no-cache ?id=1')
        expect(new Set(asked.slice(0, answered))).toEqual(
            new Set(['force-cache ?id=1', 'online']),
        )
        expect(asked.slice(answered)).toEqual([
            'no-cache ?id=1',
            'no-cache ?id=1',
            'force-cache ?id=2',
            'no-cache ?id=3',
        ])
    } finally {
        window.fetch = previous
        if (worker === undefined)
            delete (navigator as { serviceWorker?: unknown }).serviceWorker
        else Object.defineProperty(navigator, 'serviceWorker', worker)
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

// 16.32, 16.74 — AND THE BUILD IS WHAT MARKS IT: a handler returning an async generator is written
// into its file's browser wrapper as a stream, and one that does not is left a value — a mutation's
// as much as a read's, and an arrow handing one back or a promise of one, or a member naming one
// (`claudeCode.bridge`), as much as one declared `async function*`. THE REVERT: return false from
// `isGenerator` in `declaredExports`; no wrapper carries `stream` and every copy collects. Mark a
// `GET`'s alone and `postLines` loses it; drop the `Promise` unwrap and `awaitedLines` does.
test('the build marks a handler returning an async generator as a stream in its wrapper — 16.32', async () => {
    const { handlers } = await builtCompilation(app)
    const lineOf = (name: string): string =>
        handlers[`invoices/${name}.handler.ts`]?.client
            .split('\n')
            .find((line) => line.startsWith('export default')) ?? ''
    expect(lineOf('lines')).toContain('{"stream":true}')
    expect(lineOf('postLines')).toContain('{"stream":true}')
    expect(lineOf('pairing')).toContain('{"stream":true}')
    expect(lineOf('arrowLines')).toContain('{"stream":true}')
    expect(lineOf('awaitedLines')).toContain('{"stream":true}')
    expect(lineOf('getInvoice')).not.toContain('stream')
})

// 20.4 — A HANDLER WITHHELD FROM THE UI GETS NO WRAPPER, so a page importing it is 16.29's compile
// error rather than a call the browser was quietly handed; the handler still answers over http. THE
// REVERT: write a handler file's face whatever `mount.ui` says in `compileApp`; the build succeeds and
// the page ships a call to a handler its author withheld.
test('a handler with clients.ui false gets no browser wrapper — 20.4', async () => {
    const HANDLERS = {
        'staff/internal.handler.ts': `import { GET } from '@abide/abide/server'\n\nexport default GET(() => 'staff only', { clients: { ui: false } })\n`,
        'staff/open.handler.ts': `import { GET } from '@abide/abide/server'\n\nexport default GET(() => 'anyone')\n`,
    }
    const refused = appFixture({
        'index.abide': `<script>
import { reactive } from '@abide/abide'
import internal from '#src/staff/internal.handler.ts'

const value = reactive(() => internal())
</script>

<p>{value()}</p>`,
        ...HANDLERS,
    })
    const built = await buildApp(refused)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('internal')

    const allowed = appFixture({
        'index.abide': `<script>
import { reactive } from '@abide/abide'
import open from '#src/staff/open.handler.ts'

const value = reactive(() => open())
</script>

<p>{value()}</p>`,
        ...HANDLERS,
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
        painted: { promise: painted.promise, response: undefined, painted: 1 },
        'in flight': { promise: inFlight.promise, response: undefined },
        answered: {
            promise: Promise.resolve(),
            response: new Response('{}'),
            painted: 1,
        },
    }
    try {
        let ended = false
        paintedCallsLanded()?.then(() => {
            ended = true
        })
        await new Promise((done) => setTimeout(done, 0))
        expect(ended).toBe(false)
        // The request failed: the promise settles and no response was ever set.
        painted.settle()
        await new Promise((done) => setTimeout(done, 0))
        expect(ended).toBe(true)

        window.__abideCalls = {
            'in flight': { promise: inFlight.promise, response: undefined },
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
