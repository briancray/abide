// SECTION 20 AND 36.7 — THE SURFACES GENERATED OFF THE ROUTE TABLE, opened, over a served app (spawned,
// for `serve.test.ts`'s reason).

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const HANDLERS = `import { GET, jsonSchema, log, POST, reactive, refuse } from 'abide/server'

export const listInvoices = GET(() => [{ id: 1 }], { description: 'Every invoice.' })

export const getInvoice = GET(
    reactive(async ({ id }: { id: number }) => ({ id, total: id * 10 }), {
        args: jsonSchema({ type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] }),
    }),
    { description: 'One invoice.' },
)

export const pay = POST(({ amount }: { amount: number }) => ({ paid: amount }), { description: 'Pay.' })

export const hidden = GET(() => 'secret', { clients: { mcp: false, openapi: false } })

export const guarded = POST(() => 'never', {
    description: 'Refused by its rung.',
    middleware: [async () => refuse(401, 'no')],
})

export const shout = POST(({ text }: { text: string }) => {
    log(text)
})
`

let base = ''
let stop = (): void => {}
let app = ''

const SERVER = new URL('../src/server', import.meta.url).pathname

beforeAll(async () => {
    process.env.ABIDE_OPENAPI = '1'
    // 36.7, 27.8 — A SURFACE'S SWITCH IS A BOOLEAN, read in the environment's spelling of one. THE
    // REVERT: drop the standing `false`s from `config`; `TRUE` stays text and MCP answers 404.
    process.env.ABIDE_MCP = 'TRUE'
    process.env.ABIDE_LOGS = '1'
    ;({ app, base, stop } = await serveApp({
        'ui/pages/page.abide': '<main>home</main>',
        'server/rpc/invoices.ts': HANDLERS,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

async function mcp(
    method: string,
    params?: unknown,
): Promise<Record<string, unknown>> {
    const answer = await Bun.fetch(`${base}/__abide/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    return (await answer.json()) as Record<string, unknown>
}

// 21.4 — THE GENERATED SURFACES ARE NEVER CACHED. THE REVERT: answer the surfaces table with
// `private, no-store`, or hand MCP's JSON-RPC back as its own `Response`; the header reads otherwise.
test('the OpenAPI document and an MCP answer are never cached — 21.4', async () => {
    const document = await Bun.fetch(`${base}/__abide/openapi.json`)
    expect(document.headers.get('cache-control')).toBe('no-store')
    await document.text()
    const answer = await Bun.fetch(`${base}/__abide/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(answer.headers.get('cache-control')).toBe('no-store')
    expect(await answer.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
})

// 20.1, 20.3, 20.6, 20.11 — EVERY HANDLER BUT THE ONE WITHHELD, with its schema as it was declared.
// THE REVERT: skip the `clients` test in `listed`; `hidden` is published.
test('the OpenAPI document is derived from the route table — 20.1, 20.6, 20.11', async () => {
    const answer = await Bun.fetch(`${base}/__abide/openapi.json`)
    const document = (await answer.json()) as {
        openapi: string
        paths: Record<
            string,
            Record<string, { parameters?: unknown[]; description?: string }>
        >
    }
    expect(document.openapi).toBe('3.1.0')
    const paths = Object.keys(document.paths).sort()
    expect(paths).toEqual([
        '/__abide/rpc/invoices/getInvoice',
        '/__abide/rpc/invoices/guarded',
        '/__abide/rpc/invoices/listInvoices',
        '/__abide/rpc/invoices/pay',
        '/__abide/rpc/invoices/shout',
    ])
    const get = document.paths['/__abide/rpc/invoices/getInvoice']?.get
    expect(get?.description).toBe('One invoice.')
    expect(get?.parameters).toEqual([
        {
            name: 'id',
            in: 'query',
            required: true,
            schema: { type: 'integer' },
        },
    ])
})

// 20.9 — A HANDLER TAKING NO ARGS IS A RESOURCE and one taking args, or a mutation, is a TOOL, read off
// the arm `GET` took. THE REVERT: list every `GET` as a resource; `getInvoice` is not a tool.
test('MCP lists tools and resources by the arm GET took — 20.9', async () => {
    const init = (await mcp('initialize')).result as {
        capabilities: Record<string, unknown>
    }
    expect(Object.keys(init.capabilities).sort()).toEqual([
        'resources',
        'tools',
    ])
    const tools = (
        (await mcp('tools/list')).result as { tools: { name: string }[] }
    ).tools
    expect(tools.map((tool) => tool.name).sort()).toEqual([
        'invoices_getInvoice',
        'invoices_guarded',
        'invoices_pay',
        'invoices_shout',
    ])
    const resources = (
        (await mcp('resources/list')).result as { resources: { uri: string }[] }
    ).resources
    expect(resources.map((resource) => resource.uri)).toEqual([
        'abide:/__abide/rpc/invoices/listInvoices',
    ])
})

// 20.10, 19.8 — A CALL IS A REQUEST THROUGH THE APP, so a rung refuses it as it would anyone, and the
// args arrive coerced as a browser's would.
test('an MCP call is answered through the app, refusals included — 20.10', async () => {
    const called = (
        await mcp('tools/call', {
            name: 'invoices_getInvoice',
            arguments: { id: 4 },
        })
    ).result as { content: { text: string }[]; isError: boolean }
    expect(called.isError).toBe(false)
    expect(JSON.parse(called.content[0]?.text as string)).toEqual({
        id: 4,
        total: 40,
    })

    const refused = (
        await mcp('tools/call', { name: 'invoices_guarded', arguments: {} })
    ).result as { isError: boolean }
    expect(refused.isError).toBe(true)

    const read = (
        await mcp('resources/read', {
            uri: 'abide:/__abide/rpc/invoices/listInvoices',
        })
    ).result as { contents: { text: string }[] }
    expect(JSON.parse(read.contents[0]?.text as string)).toEqual([{ id: 1 }])
})

// 16.14 — THE MCP ENDPOINT IS GATED ON `Origin` AS A MUTATION IS. A tool call runs its handler with
// the caller's cookies, and a `text/plain` POST crosses origins with no preflight, so another origin's
// page could otherwise run any published mutation as its reader. From the app's own origin the call
// is answered. THE REVERT: drop the gate in `answerMcp`; the cross-origin call is answered 200 and
// the mutation runs.
test('a cross-origin POST to the MCP endpoint is refused, and a same-origin one answered — 16.14', async () => {
    const payFrom = (origin: string): Promise<Response> =>
        Bun.fetch(`${base}/__abide/mcp`, {
            method: 'POST',
            headers: { 'content-type': 'text/plain', origin },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: { name: 'invoices_pay', arguments: { amount: 5 } },
            }),
        })
    const crossing = await payFrom('https://elsewhere.example')
    expect(crossing.status).toBe(403)
    const own = await payFrom(new URL(base).origin)
    expect(own.status).toBe(200)
    const called = ((await own.json()) as Record<string, unknown>).result as {
        content: { text: string }[]
        isError: boolean
    }
    expect(called.isError).toBe(false)
    expect(JSON.parse(called.content[0]?.text as string)).toEqual({ paid: 5 })
})

// 20.10, 42.12 — AN MCP CALL IS ANSWERED BY THE APP IT WAS MADE TO, not by whichever `App` the process
// built last: two held in one process, the second stopped, and the first still answers its tools. THE
// REVERT: set `RPC_SERVER.raw` to the app's own `fetch` alone in `createApp`, not the scope's app
// first; the stopped app answers the call 503.
test('an MCP call is answered by its own App, not the last one built — 20.10, 42.12', async () => {
    await Bun.write(
        `${app}/host.ts`,
        // `bootApp` and `loadBuild` by path: the fixture builds beside itself rather than where
        // `createApp` looks (`buildDirectory`).
        `import { bootApp, originUnder } from '${SERVER}/createApp.ts'
import { loadBuild } from '${SERVER}/serveBuild.ts'

const boot = () => bootApp(originUnder('${app}'), () => loadBuild({ root: '${app}', out: '${app}/.abide' }))
const first = await boot()
const second = await boot()
await second.stop()
const answer = await first.fetch(new Request('http://app.test/__abide/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'invoices_getInvoice', arguments: { id: 4 } } }),
}))
console.log(JSON.stringify(await answer.json()))
`,
    )
    const ran = Bun.spawnSync(['bun', `${app}/host.ts`], {
        cwd: app,
        env: process.env,
    })
    const printed = ran.stdout.toString().trim().split('\n').at(-1) as string
    if (ran.exitCode !== 0) console.log(ran.stderr.toString())
    expect(ran.exitCode).toBe(0)
    const called = (
        JSON.parse(printed) as {
            result: { content: { text: string }[]; isError: boolean }
        }
    ).result
    expect(called.content[0]?.text).toBe('{"id":4,"total":40}')
    expect(called.isError).toBe(false)
}, 30_000)

// 36.7, 28.1 — THE `GET` OVER `log.records`: a line written after the reader subscribed arrives as an
// event.
//
// RUN ALONE the ring is empty when the subscription opens. THE REVERT: drop the comment frame an
// sse `bodyOf` opens with; the head is held until the first record, and alone this times out.
test('the logs GET streams log.records as events — 36.7, 28.1', async () => {
    const answer = await Bun.fetch(`${base}/__abide/logs`)
    expect(answer.headers.get('content-type')).toBe('text/event-stream')
    const reader = (answer.body as ReadableStream<Uint8Array>).getReader()
    await Bun.fetch(`${base}/__abide/rpc/invoices/shout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"text":"a line worth reading"}',
    })
    let seen = ''
    while (!seen.includes('a line worth reading')) {
        const next = await reader.read()
        if (next.done) break
        seen += new TextDecoder().decode(next.value)
    }
    await reader.cancel()
    expect(seen).toContain('"message":"a line worth reading"')
})
