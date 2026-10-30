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

export const stamped = GET(() => ({ at: new Date(), count: 1 }), { description: 'When.' })

export const traced = GET(
    () => (log.records.peek() ?? []).filter((record) => record.namespace === 'abide:mcp').map((record) => record.message),
    { clients: { mcp: false, openapi: false } },
)

export const tagged = POST(({ id }: { id: string }) => Response.json({ id }), {
    description: 'Back on.',
    clients: { mcp: true },
})

export const drawn = GET(() => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), {
    description: 'A picture.',
})

export const sketched = GET(() => new Blob(['<svg/>'], { type: 'image/svg+xml' }), {
    description: 'A drawing a model is not shown.',
})

export const charted = GET(
    () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }) as unknown as { total: number },
    { description: 'A chart typed as a total.' },
)
`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ base, stop } = await serveApp(
        {
            'index.abide': '<main>home</main>',
            ...handlerFiles('invoices', HANDLERS),
            'files/[[folder]]/listFiles.handler.ts': `import { GET } from '@abide/abide/server'

export default GET(({ folder }: { folder?: string }) => [folder ?? '/'], {
    clients: { mcp: false },
})
`,
        },
        // 20.18's lines are `debug`, kept in `log.records` only once `DEBUG` opens them.
        { ...process.env, DEBUG: 'abide:mcp' },
    ))
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
        '/invoices/charted',
        '/invoices/drawn',
        '/invoices/getInvoice',
        '/invoices/guarded',
        '/invoices/listInvoices',
        '/invoices/pay',
        '/invoices/playlist',
        '/invoices/shout',
        '/invoices/sketched',
        '/invoices/stamped',
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
// `invoices_playlist` is listed, ten tools rather than nine.
test('MCP lists every handler as a tool — 20.9', async () => {
    const init = (await mcp('initialize')).result as {
        capabilities: Record<string, unknown>
    }
    expect(Object.keys(init.capabilities)).toEqual(['tools'])
    const tools = (
        (await mcp('tools/list')).result as { tools: { name: string }[] }
    ).tools
    expect(tools.map((tool) => tool.name).sort()).toEqual(
        [
            'get_invoices_charted',
            'get_invoices_drawn',
            'get_invoices_getInvoice',
            'get_invoices_listInvoices',
            'post_invoices_guarded',
            'post_invoices_pay',
            'get_invoices_sketched',
            'get_invoices_stamped',
            'post_invoices_shout',
            'post_invoices_tagged',
        ].sort(),
    )
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

// 20.21 — AN IMAGE ANSWERED IS ONE IMAGE ITEM, base64 with its type, in place of its bytes read as
// text, and no structured content. THE REVERT: drop the image branch in `#called` and the call
// answers its PNG's bytes as a text item.
test('an MCP call answered with an image carries it as an image item — 20.21', async () => {
    const called = (await mcp('tools/call', { name: 'get_invoices_drawn' }))
        .result as {
        content: {
            type: string
            data?: string
            mimeType?: string
            text?: string
        }[]
        structuredContent?: unknown
        isError: boolean
    }
    expect(called.isError).toBe(false)
    expect(called.content).toEqual([
        { type: 'image', data: 'iVBORw==', mimeType: 'image/png' },
    ])
    expect(called.structuredContent).toBeUndefined()
})

// 20.21 — AN IMAGE OF A TYPE A MODEL IS NOT SHOWN IS ITS TEXT: an svg answers as a text item. THE
// REVERT: take any `image/*` as an image in `#called` and the call answers an image item no model takes.
test('an MCP call answered with an svg carries it as its text — 20.21', async () => {
    const called = (await mcp('tools/call', { name: 'get_invoices_sketched' }))
        .result as {
        content: { type: string; text?: string }[]
        isError: boolean
    }
    expect(called.isError).toBe(false)
    expect(called.content).toEqual([{ type: 'text', text: '<svg/>' }])
})

// 20.22 — A TOOL THAT DECLARES AN `outputSchema` AND ANSWERS AN IMAGE IS REFUSED, naming the tool and
// the type, rather than handing a client an image with no structured content. THE REVERT: drop the
// `structured(one)` branch in `#called` and the call answers `isError: false` with an image item.
test('a tool declaring a result schema that answers an image is refused — 20.22', async () => {
    const listed = (await mcp('tools/list')).result as {
        tools: { name: string; outputSchema?: { type?: string } }[]
    }
    expect(
        listed.tools.find((tool) => tool.name === 'get_invoices_charted')
            ?.outputSchema?.type,
    ).toBe('object')
    const called = (await mcp('tools/call', { name: 'get_invoices_charted' }))
        .result as {
        content: { type: string; text?: string }[]
        structuredContent?: unknown
        isError: boolean
    }
    expect(called.isError).toBe(true)
    expect(called.content).toEqual([
        {
            type: 'text',
            text: 'get_invoices_charted declares a result schema but answered an image, image/png.',
        },
    ])
    expect(called.structuredContent).toBeUndefined()
})

// 20.18 — EVERY TOOL CALL WRITES ONE LINE ON `abide:mcp`, naming the tool and its status, a refused
// call and a call to a tool not published included. THE REVERT: drop the `logCall` in `#called`
// and neither published call writes a line; drop the one before `mcpFailure` and the missing one
// writes none.
test('every tool call writes one debug line on abide:mcp — 20.18', async () => {
    await mcp('tools/call', { name: 'get_invoices_stamped' })
    await mcp('tools/call', { name: 'post_invoices_guarded', arguments: {} })
    await mcp('tools/call', { name: 'get_invoices_nowhere' })
    const lines = (await (
        await Bun.fetch(`${base}/invoices/traced`)
    ).json()) as string[]
    const calls = lines.filter(
        (line) =>
            line.startsWith('call get_invoices_stamped ') ||
            line.startsWith('call post_invoices_guarded '),
    )
    expect(calls.at(-2)).toMatch(/^call get_invoices_stamped 200 \d+\.\dms$/)
    expect(calls.at(-1)).toMatch(/^call post_invoices_guarded 401 \d+\.\dms$/)
    expect(lines).toContain('call get_invoices_nowhere 404 0.0ms')
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

type Tool = {
    name: string
    annotations?: Record<string, boolean>
    outputSchema?: unknown
}

async function listedTools(): Promise<Map<string, Tool>> {
    const tools = ((await mcp('tools/list')).result as { tools: Tool[] }).tools
    const byName = new Map<string, Tool>()
    for (const tool of tools) byName.set(tool.name, tool)
    return byName
}

// 20.14 — A TOOL SAYS WHAT ITS METHOD PROMISES: a `GET` safe and idempotent, a `POST` a write that may
// destroy. THE REVERT: drop `annotations` from `McpSurface.list`; both read `undefined`.
test('a tool is annotated from its handler’s method — 20.14', async () => {
    const tools = await listedTools()
    expect(tools.get('get_invoices_getInvoice')?.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
    })
    expect(tools.get('post_invoices_pay')?.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
    })
})

// 19.21, 19.22, 19.23, 20.15 — WHAT A HANDLER ANSWERS IS PUBLISHED AS ITS TYPE SAYS, and nothing is published
// where it says nothing true: no `additionalProperties: false` on an answer, a `Date` member left
// unconstrained, and no schema for a value that may be nothing or is a whole `Response`. THE REVERTS:
// drop `result` from `surfaceOf`, and `pay` publishes none; keep `additionalProperties: false` on an
// answer, and `pay`'s schema carries it; walk an instance's members, and `at` is an object
// with every method of `Date` required.
test('the OpenAPI document publishes what each handler answers — 19.21, 19.22, 19.23, 20.15', async () => {
    const answer = await Bun.fetch(`${base}/__abide/openapi.json`)
    const document = (await answer.json()) as {
        paths: Record<
            string,
            Record<
                string,
                {
                    responses: Record<
                        string,
                        { content?: Record<string, { schema?: unknown }> }
                    >
                }
            >
        >
    }
    const answered = (path: string, method: string): unknown =>
        document.paths[path]?.[method]?.responses['200']?.content?.[
            'application/json'
        ]?.schema
    expect(answered('/invoices/pay', 'post')).toEqual({
        type: 'object',
        properties: { paid: { type: 'number' } },
        required: ['paid'],
    })
    expect(answered('/invoices/listInvoices', 'get')).toEqual({
        type: 'array',
        items: {
            type: 'object',
            properties: { id: { type: 'number' } },
            required: ['id'],
        },
    })
    expect(answered('/invoices/stamped', 'get')).toEqual({
        type: 'object',
        properties: { at: {}, count: { type: 'number' } },
        required: ['at', 'count'],
    })
    // 19.23: `getInvoice`'s `args` is a `jsonSchema` with no type argument, which typed its value
    // `undefined` and published nothing.
    expect(answered('/invoices/getInvoice', 'get')).toEqual({
        type: 'object',
        properties: { id: { type: 'number' }, total: { type: 'number' } },
        required: ['id', 'total'],
    })
    expect(answered('/invoices/shout', 'post')).toBeUndefined()
    expect(answered('/invoices/playlist', 'post')).toBeUndefined()
})

// 20.16 — A TOOL ANSWERING AN OBJECT DECLARES ITS SHAPE AND ANSWERS IT STRUCTURED, the text kept beside
// it; one answering anything else declares none. THE REVERT: leave `structuredContent` out of
// `tools/call`; the call reads `undefined`.
test('a tool answering an object declares an output schema and answers structured content — 20.16', async () => {
    const tools = await listedTools()
    expect(tools.get('post_invoices_pay')?.outputSchema).toEqual({
        type: 'object',
        properties: { paid: { type: 'number' } },
        required: ['paid'],
    })
    expect(tools.get('get_invoices_listInvoices')?.outputSchema).toBeUndefined()
    const called = (
        await mcp('tools/call', {
            name: 'post_invoices_pay',
            arguments: { amount: 4 },
        })
    ).result as {
        content: { text: string }[]
        structuredContent?: unknown
    }
    expect(called.structuredContent).toEqual({ paid: 4 })
    expect(JSON.parse(called.content[0]?.text as string)).toEqual({
        paid: 4,
    })
    const refused = (await mcp('tools/call', { name: 'post_invoices_guarded' }))
        .result as { structuredContent?: unknown }
    expect(refused.structuredContent).toBeUndefined()
})
