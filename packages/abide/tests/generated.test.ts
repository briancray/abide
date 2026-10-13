// SECTION 20 AND 36.7 — THE SURFACES GENERATED OFF THE ROUTE TABLE, opened, over a served app (spawned,
// for `serve.test.ts`'s reason).

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { handlerFiles, serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const HANDLERS = `import { GET, jsonSchema, log, POST, reactive, refuse } from '@abide/abide/server'

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

export const playlist = POST(async ({ id }: { id: string }) => new Response(\`#EXTM3U \${id}\`), {
    description: 'A playlist.',
})

export const tagged = POST(({ id }: { id: string }) => Response.json({ id }), {
    description: 'Back on.',
    clients: { mcp: true },
})
`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'index.abide': '<main>home</main>',
        ...handlerFiles('invoices', HANDLERS),
        'files/[[folder]]/listFiles.ts': `import { GET } from '@abide/abide/server'

export default GET(({ folder }: { folder?: string }) => [folder ?? '/'], {
    clients: { mcp: false },
})
`,
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
// THE REVERT: skip the `clients` test in `surfaceOf`; `hidden` is published.
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
        '/files/{folder}/listFiles',
        '/invoices/getInvoice',
        '/invoices/guarded',
        '/invoices/listInvoices',
        '/invoices/pay',
        '/invoices/playlist',
        '/invoices/shout',
        '/invoices/tagged',
    ])
    const get = document.paths['/invoices/getInvoice']?.get
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

// 20.6 — EVERY PATH PARAMETER IS DECLARED, an optional one as present and required, as OpenAPI has no
// other kind, and saying it may be left out. THE REVERT: drop the description from `openApi`'s path
// parameters; `folder` reads as a segment every address carries.
test('every path parameter is declared, an optional one as required — 20.6', async () => {
    const answer = await Bun.fetch(`${base}/__abide/openapi.json`)
    const document = (await answer.json()) as {
        paths: Record<string, Record<string, { parameters?: unknown[] }>>
    }
    expect(
        document.paths['/files/{folder}/listFiles']?.get?.parameters,
    ).toEqual([
        {
            name: 'folder',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'May be left out, with its segment.',
        },
    ])
})

// 20.9 — EVERY LISTED HANDLER IS A TOOL, a `GET` taking no args included: a client that only calls
// tools (a bridge's Claude Code among them) reaches every read. THE REVERT: list a `GET` taking no
// args as a resource; `get_invoices_listInvoices` is not a tool.
// 16.37 — AND ONE TYPED AS RETURNING A `Response` IS NEITHER unless its `clients` puts it back:
// `playlist` is withheld, `tagged` listed. THE REVERT: default `mcp` to true in `declaringMethod`;
// `invoices_playlist` is listed, seven tools rather than six.
test('MCP lists every handler as a tool — 20.9', async () => {
    const init = (await mcp('initialize')).result as {
        capabilities: Record<string, unknown>
    }
    expect(Object.keys(init.capabilities)).toEqual(['tools'])
    const tools = (
        (await mcp('tools/list')).result as { tools: { name: string }[] }
    ).tools
    expect(tools.map((tool) => tool.name).sort()).toEqual([
        'get_invoices_getInvoice',
        'get_invoices_listInvoices',
        'post_invoices_guarded',
        'post_invoices_pay',
        'post_invoices_shout',
        'post_invoices_tagged',
    ])
    const resources = (await mcp('resources/list')).error as { code: number }
    expect(resources.code).toBe(-32601)
})

// 20.10, 19.7 — A CALL IS A REQUEST THROUGH THE APP, so a rung refuses it as it would anyone, and the
// args arrive coerced as a browser's would.
test('an MCP call is answered through the app, refusals included — 20.10', async () => {
    const called = (
        await mcp('tools/call', {
            name: 'get_invoices_getInvoice',
            arguments: { id: 4 },
        })
    ).result as { content: { text: string }[]; isError: boolean }
    expect(called.isError).toBe(false)
    expect(JSON.parse(called.content[0]?.text as string)).toEqual({
        id: 4,
        total: 40,
    })

    const refused = (
        await mcp('tools/call', {
            name: 'post_invoices_guarded',
            arguments: {},
        })
    ).result as { isError: boolean }
    expect(refused.isError).toBe(true)

    const read = (
        await mcp('tools/call', { name: 'get_invoices_listInvoices' })
    ).result as { content: { text: string }[] }
    expect(JSON.parse(read.content[0]?.text as string)).toEqual([{ id: 1 }])
})

// 16.13 — THE MCP ENDPOINT IS GATED ON `Origin` AS A MUTATION IS. A tool call runs its handler with
// the caller's cookies, and a `text/plain` POST crosses origins with no preflight, so another origin's
// page could otherwise run any published mutation as its reader. From the app's own origin the call
// is answered. THE REVERT: drop the gate in `answerMcp`; the cross-origin call is answered 200 and
// the mutation runs.
test('a cross-origin POST to the MCP endpoint is refused, and a same-origin one answered — 16.13', async () => {
    const payFrom = (origin: string): Promise<Response> =>
        Bun.fetch(`${base}/__abide/mcp`, {
            method: 'POST',
            headers: { 'content-type': 'text/plain', origin },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: { name: 'post_invoices_pay', arguments: { amount: 5 } },
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
