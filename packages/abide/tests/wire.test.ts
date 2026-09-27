// 16.2, 16.29, 16.30 AND 19.16 — A HANDLER OVER HTTP, END TO END. An app is built and served by the
// commands a host runs, and what is asserted is what crosses the wire: the address a handler answers
// at, what each outcome is answered with, what the browser's bundle was handed in place of the
// server module — and, through `wire` itself, that the browser's `Rpc` is the same value the server's
// is. Spawned for `serve.test.ts`'s reason: happy-dom's preload clobbers `Response`.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { wire } from '#ui/wire.ts'
import { appFixture, buildApp, serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

// A STRING NO BROWSER MAY EVER RECEIVE. The handler module imports it, the page imports the
// handler, and the bundle is searched for it.
const SECRET = 'db-password-7f3a91'

const INVOICES = `import { GET, POST, refuse, request, response } from 'abide/server'
import { SECRET } from '#server/database.ts'

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
`

const PAGE = `<script>
import { reactive } from 'abide'
import { getInvoice } from '#server/rpc/invoices.ts'

const invoice = reactive(() => getInvoice({ id: '4021' }))
</script>

<main><p id="total">{invoice().total}</p></main>`

let app = ''
let stop = (): void => {}
let base = ''

// 18.17 — EVERY `GET` THE WIRE LOADS IS FOLLOWED over the mux, and `followWire.test.ts` is where that
// is asserted. Here the socket never opens: happy-dom's `WebSocket` wraps `ws`, which throws an
// unhandled `error` for a host nobody listens on — which three of these tests' addresses are.
const unstubbedSocket = globalThis.WebSocket
globalThis.WebSocket = class {
    static OPEN = 1
    readyState = 0
    send(): void {}
} as unknown as typeof WebSocket
afterAll(() => {
    globalThis.WebSocket = unstubbedSocket
})

beforeAll(async () => {
    ;({ app, base, stop } = await serveApp({
        'ui/pages/page.abide': PAGE,
        'server/database.ts': `export const SECRET = '${SECRET}'\n`,
        'server/rpc/invoices.ts': INVOICES,
        // `default` answers at the module's own path.
        'server/rpc/health.ts': `import { GET } from 'abide/server'\n\nexport default GET(() => ({ up: true }))\n`,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

const RPC = '/__abide/rpc/invoices'

// 16.2, 19.1 — the file's path below `server/rpc`, then the export; 16.31 and 21.3 on the answer.
test('a handler answers at its file path and export name, as JSON — 16.2, 16.31', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/getInvoice?id=4021`)
    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toBe('application/json')
    expect(answer.headers.get('cache-control')).toBe('private, no-store')
    expect(await answer.json()).toEqual({ number: 'INV-4021', total: '$82.40' })

    const health = await Bun.fetch(`${base}/__abide/rpc/health`)
    expect(await health.json()).toEqual({ up: true })
})

// 16.42, 15.1 — the refusal the handler RETURNED, at its own status, as the four fields it is.
test('a refusal is answered at its own status with its name and data — 16.42', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/getInvoice?id=4311`)
    expect(answer.status).toBe(403)
    expect(await answer.json()).toEqual({
        name: 'NotYours',
        status: 403,
        message: 'That invoice belongs to someone else.',
        data: { owner: 'Grace Hopper' },
    })
})

// 16.32, 16.43 — nothing is 204; a throw is 500 and says nothing about itself.
test('nothing is 204, and a throw is 500 with nothing of the error in it — 16.32, 16.43', async () => {
    expect((await Bun.fetch(`${base}${RPC}/ping`)).status).toBe(204)
    const broken = await Bun.fetch(`${base}${RPC}/broken`)
    expect(broken.status).toBe(500)
    const text = await broken.text()
    expect(text).not.toContain('on fire')
    expect(JSON.parse(text).name).toBe('HttpError')
})

// 16.19, 16.21 — a mutation's args are its JSON body, and a body that is not one is a 400.
test('a mutation takes its args from the body, and refuses one that is not JSON — 16.19, 16.21', async () => {
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
test('an address or a method nothing answers is NotFound — 15.7', async () => {
    const nowhere = await Bun.fetch(`${base}${RPC}/nothingHere`)
    expect(nowhere.status).toBe(404)
    expect((await nowhere.json()).name).toBe('NotFound')
    const wrongMethod = await Bun.fetch(`${base}${RPC}/getInvoice`, {
        method: 'POST',
    })
    expect(wrongMethod.status).toBe(404)
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

// 16.29 — THE BROWSER GETS THE WRAPPER AND NOT THE MODULE. The handler module imports the secret,
// the page imports the handler, and the bundle carries the address and not the secret. THE REVERT:
// drop `fence` from `bundleClient`'s plugins; the server module is bundled as written and the
// secret is in the client — along with `abide/server` and everything it reaches.
test('the browser bundle carries the address and none of the server module — 16.29', async () => {
    const chunks = [
        ...new Bun.Glob('**/*.js').scanSync({ cwd: `${app}/.abide/client` }),
    ]
    let bundle = ''
    for (const chunk of chunks)
        bundle += await Bun.file(`${app}/.abide/client/${chunk}`).text()
    expect(bundle).not.toContain(SECRET)
    expect(bundle).toContain('../rpc/invoices/getInvoice')
})

// 16.30 — ANYTHING ELSE UNDER `server/` IS A BUILD ERROR from the client graph, never a module the
// browser silently receives. THE REVERT: return `undefined` from the fence's `onLoad` for a path
// with no wrapper; the build succeeds and the database module is in the bundle.
test('a page importing server code that is not a handler does not build — 16.30', () => {
    const leaking = appFixture({
        'ui/pages/page.abide': `<script>\nimport { SECRET } from '#server/database.ts'\n</script>\n\n<p>{SECRET}</p>`,
        'server/database.ts': `export const SECRET = '${SECRET}'\n`,
    })
    const built = buildApp(leaking)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('RULEBOOK 16.30')
})

// 19.16 — an export under `server/rpc` that is not declared as a handler is refused by name, rather
// than being an address that never answers.
test('an rpc module exporting something that is not a handler does not build — 19.16', () => {
    const stray = appFixture({
        'ui/pages/page.abide': '<p>home</p>',
        'server/rpc/invoices.ts': `import { GET } from 'abide/server'\n\nexport const getInvoice = GET(() => 1)\nexport const TAX_RATE = 0.2\n`,
    })
    const built = buildApp(stray)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('`TAX_RATE`')
    expect(built.stderr).toContain('RULEBOOK 19.16')
})

// 19.2 — two modules declaring one address is a build error naming both.
test('two handlers at one address do not build, and both files are named — 19.2', () => {
    const twice = appFixture({
        'ui/pages/page.abide': '<p>home</p>',
        'server/rpc/admin.ts': `import { GET } from 'abide/server'\n\nexport const audit = GET(() => 1)\n`,
        'server/rpc/admin/audit.ts': `import { GET } from 'abide/server'\n\nexport default GET(() => 2)\n`,
    })
    const built = buildApp(twice)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('server/rpc/admin.ts')
    expect(built.stderr).toContain('server/rpc/admin/audit.ts')
})

// 19.16 — WHAT DECLARES A HANDLER IS THE CALL, NOT THE SPELLING OF THE LINE IT STANDS ON. Every
// module below is a handler the language says is one — declared then exported, exported under
// another name, its method imported under another name or through a namespace, re-exported from a
// helper module, a default naming a binding — and none is written `export const x = GET(…)`.
// THE REVERT: read the method off the source with a pattern over that one spelling; the build is
// refused on the first of them.
test('a handler declared any way the language allows is mounted with its method — 19.16', async () => {
    const app = appFixture({
        'ui/pages/page.abide': '<p>home</p>',
        'server/shared.ts': `import { PATCH } from 'abide/server'\n\nexport const touch = PATCH(() => 1)\n`,
        'server/rpc/later.ts': `import { GET } from 'abide/server'\n\nconst find = GET(() => 1)\nexport { find }\nexport { find as lookup }\n`,
        'server/rpc/renamed.ts': `import { POST as post } from 'abide/server'\n\nexport const save = post(() => 1)\n`,
        'server/rpc/spaced.ts': `import * as abide from 'abide/server'\n\nexport const replace = abide.PUT(() => 1)\n`,
        'server/rpc/passed.ts': `export { touch } from '#server/shared.ts'\n`,
        'server/rpc/named.ts': `import { DELETE } from 'abide/server'\n\nconst drop = DELETE(() => 1)\nexport default drop\nexport type Dropped = { id: string }\n`,
    })
    const built = buildApp(app)
    expect(built.stderr).toBe('')
    expect(built.exitCode).toBe(0)
    const { handlers } = (await import(`${app}/.abide/rpc.ts`)) as {
        handlers: { address: string; method: string }[]
    }
    const methods: Record<string, string> = {}
    for (const handler of handlers) methods[handler.address] = handler.method
    expect(methods).toEqual({
        '/__abide/rpc/later/find': 'GET',
        '/__abide/rpc/later/lookup': 'GET',
        '/__abide/rpc/named': 'DELETE',
        '/__abide/rpc/passed/touch': 'PATCH',
        '/__abide/rpc/renamed/save': 'POST',
        '/__abide/rpc/spaced/replace': 'PUT',
    })
})

// 19.16 — AND A CALL NAMED `GET` THAT IS NOT abide's IS NOT A HANDLER. THE REVERT: accept the
// export by the callee's spelling; this builds, and mounts a plain number as a handler.
test('an export calling a GET that is not abide’s does not build — 19.16', () => {
    const app = appFixture({
        'ui/pages/page.abide': '<p>home</p>',
        'server/rpc/fake.ts': `const GET = (value: () => number) => value()\n\nexport const count = GET(() => 1)\n`,
    })
    const built = buildApp(app)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('`count`')
    expect(built.stderr).toContain('RULEBOOK 19.16')
})

// THE BROWSER'S `Rpc`, against the served handler. `wire` is what a generated wrapper calls, so this
// is the value a page holds: it answers with the handler's value, it joins a standing call with the
// same args (1.8), a refusal narrows by name (16.9), and a mutation calls again (16.7). The wire is
// counted, because a call that re-fetched would still answer right.
test('the wire is the same Rpc: coalesced, narrowable, and a mutation calls again — 16.4, 16.29', async () => {
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

// 41.22 — A CALL THE PAGE ALREADY STARTED IS TAKEN, ONCE. Asserted by what reached `fetch`, because a
// wire that fetched again would answer the same invoice. THE REVERT: skip the `EARLY_CALLS` lookup
// in `wire`; the first reach fetches — one call where none is due — and lands a turn later.
test('the wire takes a call the page already started, and fetches after that — 41.22', async () => {
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
        // Answered before the bundle ran.
        'GET /rpc/getInvoice?id=7 ': {
            promise: Promise.resolve(),
            status: 200,
            statusText: 'OK',
            text: '{"id":"7"}',
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

// 16.33 — A FRAMED STREAM IS THE CHUNKS IT CARRIED, in each framing the server can answer in. THE
// REVERT: drop the jsonl arm from `answered`; the body is not one JSON value, and the call refuses.
test('the wire collects a jsonl or sse answer into its chunks — 16.33', async () => {
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

// 16.33 — A STREAMING HANDLER'S COPY TAKES EACH CHUNK AS ITS LINE ARRIVES. The answer's second line
// is not sent until the copy has shown the first, so a copy that collected would show nothing at
// all and the race reports it. No clock is read: the order is the claim.
//
// THE REVERT: declare `body` rather than `streamed` for a marked copy in `wire`; the first read loses
// the race, and the value lands once, whole, when the answer closes.
test('a copy the build marked as streaming holds each chunk as it lands — 16.33', async () => {
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

// 16.33 — AND THE BUILD IS WHAT MARKS IT: a handler declared as an async generator is written into the
// browser's wrapper as a stream, and one that is not is left a value. THE REVERT: drop `declaresStream`
// from `declaringMethod`; the wrapper carries no `stream` and the copy collects.
test('the build marks an async generator handler as a stream in its wrapper — 16.33', async () => {
    const wrapper = await Bun.file(
        `${app}/.abide/wire/server/rpc/invoices.ts`,
    ).text()
    const lineOf = (name: string): string =>
        wrapper.split('\n').find((line) => line.includes(`const ${name} =`)) ??
        ''
    expect(lineOf('lines')).toContain('{"stream":true}')
    expect(lineOf('getInvoice')).not.toContain('stream')
})

// 20.4 — A HANDLER WITHHELD FROM THE UI GETS NO WRAPPER, so a page importing it is 16.30's compile
// error rather than a call the browser was quietly handed; the handler still answers over http. THE
// REVERT: write a wrapper for every mount in `wrappersOf`; the build succeeds and the page ships a call
// to a handler its author withheld.
test('a handler with clients.ui false gets no browser wrapper — 20.4', async () => {
    const HANDLERS = `import { GET } from 'abide/server'

export const internal = GET(() => 'staff only', { clients: { ui: false } })

export const open = GET(() => 'anyone')
`
    const refused = appFixture({
        'ui/pages/page.abide': `<script>
import { reactive } from 'abide'
import { internal } from '#server/rpc/staff.ts'

const value = reactive(() => internal())
</script>

<p>{value()}</p>`,
        'server/rpc/staff.ts': HANDLERS,
    })
    const built = buildApp(refused)
    expect(built.exitCode).not.toBe(0)
    expect(built.stderr).toContain('internal')

    const allowed = appFixture({
        'ui/pages/page.abide': `<script>
import { reactive } from 'abide'
import { open } from '#server/rpc/staff.ts'

const value = reactive(() => open())
</script>

<p>{value()}</p>`,
        'server/rpc/staff.ts': HANDLERS,
    })
    expect(buildApp(allowed).exitCode).toBe(0)
})
