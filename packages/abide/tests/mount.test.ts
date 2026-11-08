// 16.10, 36.11 — AN APP SERVED UNDER A SUB-PATH, set by `APP_URL` alone: the same build, every address
// resolved against the mount at run time (spawned, for `serve.test.ts`'s reason).

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { lastLinePrinted, serveApp } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const PAGE = `<script>
import { reactive, url } from '@abide/abide'
import getInvoice from '#src/invoices/getInvoice.handler.ts'
import '#src/lib/face.css'

const invoice = reactive(() => getInvoice({ id: '4' }))
</script>

<main><a id="home" href={url('/')}>home</a><a id="link" href={url('/invoices/[id]', { id: 4 })}>four</a><p id="total">{invoice().total}</p></main>`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ base, stop } = await serveApp(
        {
            'index.abide': PAGE,
            'invoices/[id]/index.abide': `<script>
import { route } from '@abide/abide'
</script>

<main>an invoice at <b id="at">{route.url().pathname}</b></main>`,
            // 37.16, 37.17 — a root rung that says what it was handed, and a gate over pages alone
            // that sends a closed caller to the login page — written by lane and by the app's own
            // address, with no address of abide's spelled out.
            'layout.abide': `<script server>
import { url } from '@abide/abide'
import { middleware, response } from '@abide/abide/server'

middleware((next, { request }) =>
    new URL(request.url).pathname === '/alias'
        ? next({ request: new Request(new URL('/robots.txt', request.url)) })
        : next(),
)
middleware((next, { request, lane }) => {
    const path = new URL(request.url).pathname
    response().headers.set('x-lane', lane + ' ' + path)
    const gate = request.headers.get('x-gate')
    if (gate === 'closed' && lane === 'page' && path !== '/login')
        return new Response(null, { status: 302, headers: { location: url('/login') } })
    if (gate === 'sockets' && lane === 'socket')
        return new Response('no sockets', { status: 403 })
    return next()
})
</script>

<script>
import { url } from '@abide/abide'
</script>

<html><head><link rel="preload" href={url('/fonts/face.woff2')} as="font"><link rel="preconnect" href="//cdn.example.test"></head><body><slot/></body></html>`,
            'lib/face.css': `@font-face { font-family: Face; src: url('/fonts/face.woff2'); }\n`,
            'public/fonts/face.woff2': 'a face',
            'public/robots.txt': 'User-agent: *\n',
            'login.abide': '<main>sign in</main>',
            'invoices/getInvoice.handler.ts': `import { GET } from '@abide/abide/server'\n\nexport default GET(async ({ id }: { id: string }) => ({ id, total: 99 }))\n`,
            // a segment named as the mount, which an address missing the mount is mistaken for
            'docs/getDoc.handler.ts': `import { GET } from '@abide/abide/server'\n\nexport default GET(async ({ id }: { id: string }) => ({ id, title: 'a doc' }), { description: 'A doc.' })\n`,
            'invoices/count.handler.ts': `import { GET, reactive } from '@abide/abide/server'\n\nexport default GET(reactive({ open: 3 }, { global: true }))\n`,
        },
        { ...process.env, APP_URL: 'http://example.test/docs/' },
    ))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// 16.10 — THE DOCUMENT NAMES THE MOUNT AND LOADS EVERYTHING FROM UNDER IT, and an address `url` built
// is under it too. THE REVERT: leave `clientTags` on `CLIENT_ADDRESS` bare; the entry is asked for at
// the root, where nothing of this app's is.
test('a page under the mount loads from under it — 16.10', async () => {
    const answer = await Bun.fetch(`${base}/docs`)
    expect(answer.status).toBe(200)
    const html = await answer.text()
    expect(html).toContain('<meta name="abide-mount" content="/docs">')
    expect(html).toMatch(
        /<script type="module" src="\/docs\/__abide\/client\/entry-[^"]+\.js">/,
    )
    expect(html).toContain('<a id="link" href="/docs/invoices/4">four</a>')
    // 41.20 — the early call is the address the browser's own call is made at.
    expect(html).toContain('/docs/invoices/getInvoice?id=4')
    const entry = /src="(\/docs\/__abide\/client\/entry-[^"]+\.js)"/.exec(
        html,
    )?.[1] as string
    expect((await Bun.fetch(`${base}${entry}`)).status).toBe(200)
})

// 36.11 — every other address answers under the mount: a route, a handler, a public file.
test('routes, handlers and public files answer under the mount — 36.11', async () => {
    expect(await (await Bun.fetch(`${base}/docs/invoices/4`)).text()).toContain(
        'an invoice',
    )
    expect(
        await (await Bun.fetch(`${base}/docs/invoices/getInvoice?id=4`)).json(),
    ).toEqual({
        id: '4',
        total: 99,
    })
    expect(await (await Bun.fetch(`${base}/docs/robots.txt`)).text()).toBe(
        'User-agent: *\n',
    )
})

// 18.1, 36.11 — THE MUX ANSWERS UNDER THE MOUNT, and an address named as the browser's wrapper resolved
// it — a path under the mount, or a whole URL — reaches the handler it names.
test('the mux answers under the mount, for an address under it or a whole URL — 18.1, 36.11', async () => {
    const dir = temporaryModule({
        'client.ts': `const base = process.argv[2]
const frames: unknown[] = []
let bothArrived = (): void => {}
const arrived = new Promise<void>((done) => (bothArrived = done))
const ws = new WebSocket(base.replace('http', 'ws') + '/docs/__abide/socket')
ws.onmessage = (event) => {
    frames.push(JSON.parse(String(event.data)))
    if (frames.length === 2) bothArrived()
}
await new Promise((done) => (ws.onopen = done))
ws.send(JSON.stringify({ op: 'sub', id: 1, address: '/docs/invoices/count' }))
ws.send(JSON.stringify({ op: 'sub', id: 2, address: base + '/docs/invoices/count' }))
await Promise.race([arrived, new Promise((done) => setTimeout(done, 3000).unref())])
// CLOSED AND DRAINED before anything is said: a frame sent before the close lands ahead of it.
ws.close()
await new Promise((done) => (ws.onclose = done))
console.log(JSON.stringify(frames))
`,
    })
    const frames = await lastLinePrinted<
        { op: string; id: number; value?: unknown }[]
    >(['bun', `${dir}/client.ts`, base])

    expect(frames.map((frame) => [frame.op, frame.id, frame.value])).toEqual([
        ['value', 1, { open: 3 }],
        ['value', 2, { open: 3 }],
    ])
})

// 16.10, 23.4 — A PAGE IS WHERE IT IS SERVED, on the server as in the browser: the request reaches the
// route with the mount taken off, and the browser's router arrives at `location`. THE REVERT: `arrive`
// the request's own URL in `answerRequest`; the server renders `/invoices/4` and the browser hydrates
// against `/docs/invoices/4`.
test('a page reads the address it is served at — 16.10, 23.4', async () => {
    const html = await (await Bun.fetch(`${base}/docs/invoices/4`)).text()
    expect(html).toMatch(/id="at">(<!--[^>]*-->)?\/docs\/invoices\/4</)
})

// 16.10, 30.26, 36.11 — WHAT THE ROOT LAYOUT AND THE STYLESHEET NAME AT THE ROOT IS THE MOUNT'S. The
// layout's head spells a public file with `url`, and the stylesheet's is written relative to the
// bundle it is served from. THE REVERTS: `url` returning its pattern unmounted, and
// `stylesheetUnderMount` the sheet — both then name `/fonts/face.woff2`, the origin's root, where
// nothing of this app's is.
test('the root layout and the stylesheet name a public file under the mount — 16.10, 36.11', async () => {
    const html = await (await Bun.fetch(`${base}/docs`)).text()
    expect(html).toContain(
        '<link rel="preload" href="/docs/fonts/face.woff2" as="font">',
    )
    expect(html).toContain('<link rel="preconnect" href="//cdn.example.test">')
    const sheet = /href="(\/docs\/__abide\/client\/entry-[^"]+\.css)"/.exec(
        html,
    )?.[1] as string
    const css = await (await Bun.fetch(`${base}${sheet}`)).text()
    const face = /url\(["']?([^"')]+)/.exec(css)?.[1] as string
    const resolved = new URL(face, `${base}${sheet}`)
    expect(resolved.pathname).toBe('/docs/fonts/face.woff2')
    expect(await (await Bun.fetch(resolved)).text()).toBe('a face')
})

// 19.17 — THE ROOT BELOW A MOUNT IS THE BARE MOUNT: `url('/')` writes `/docs`, and `/docs/` is sent
// there so the root has one address. A path, not a URL, so a proxy's origin is not the one written
// back. THE REVERT: `mounted('/')` as `/docs/` and the redirect the other way; the link reads
// `/docs/` and `/docs/` is a 200.
test('the root below a mount is the bare mount — 19.17', async () => {
    const html = await (await Bun.fetch(`${base}/docs`)).text()
    expect(html).toContain('<a id="home" href="/docs">home</a>')
    const answer = await Bun.fetch(`${base}/docs/?from=bar`, {
        redirect: 'manual',
    })
    expect(answer.status).toBe(308)
    expect(answer.headers.get('location')).toBe('/docs?from=bar')
})

// 20.10, 36.11 — AN MCP CALL IS THE REQUEST A BROWSER UNDER THE MOUNT WOULD MAKE, so it reaches the
// handler the tool names. THE REVERT: build `callOf`'s URL from the bare address; `/docs/getDoc`
// loses the `/docs` it never had for the mount and is asked as `/getDoc`, a 404.
test('an MCP tool call reaches its handler under the mount — 20.10, 36.11', async () => {
    const answer = await Bun.fetch(`${base}/docs/__abide/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'get_docs_getDoc', arguments: { id: '4' } },
        }),
    })
    const called = ((await answer.json()) as Record<string, unknown>)
        .result as { content: { text: string }[]; isError: boolean }
    expect(called.isError).toBe(false)
    expect(JSON.parse(called.content[0]?.text as string)).toEqual({
        id: '4',
        title: 'a doc',
    })
})

// 37.16 — A ROOT RUNG IS TOLD WHAT ANSWERS THE REQUEST, by the arm of the dispatch it takes: a page and
// an address nothing answers, a handler (abide's own `health` among them), a public file, each surface
// of abide's own, and the rest of `/__abide`. 37.17 — AND IS HANDED IT BELOW THE MOUNT, so the app's
// own address is spelled as its route is. THE REVERTS: answer `'page'` from `laneOf` for everything,
// and the gate sends the handler, the file and every surface of abide's own to the login page; hand
// the root rungs the request as it arrived in `App.fetch`, and every path reads `/docs/…` and the
// gate redirects `/docs/login` to itself, a loop; and keep `ctx.lane` for the request a rung hands
// `next` in `answering`, and `/alias`, handed on as the public file, reads `page`.
test('a root rung is told the lane, below the mount, and a page-only gate closes pages alone — 37.16, 37.17', async () => {
    const asked = async (path: string): Promise<string> => {
        const answer = await Bun.fetch(`${base}/docs${path}`, {
            headers: { 'x-gate': 'closed' },
            redirect: 'manual',
        })
        const sent =
            answer.status === 302 ? ` -> ${answer.headers.get('location')}` : ''
        return `${answer.status} ${answer.headers.get('x-lane')}${sent}`
    }
    const html = await (await Bun.fetch(`${base}/docs`)).text()
    const entry = /src="\/docs(\/__abide\/client\/entry-[^"]+\.js)"/.exec(
        html,
    )?.[1] as string
    expect({
        page: await asked('/invoices/4'),
        login: await asked('/login'),
        nowhere: await asked('/nowhere'),
        handler: await asked('/invoices/getInvoice?id=4'),
        health: await asked('/__abide/health'),
        file: await asked('/robots.txt'),
        openapi: await asked('/__abide/openapi.json'),
        bridge: await asked('/__abide/bridge'),
        bundle: await asked(entry),
        alias: await asked('/alias'),
    }).toEqual({
        page: '302 page /invoices/4 -> /docs/login',
        login: '200 page /login',
        nowhere: '302 page /nowhere -> /docs/login',
        handler: '200 handler /invoices/getInvoice',
        health: '200 handler /__abide/health',
        file: '200 file /robots.txt',
        openapi: '200 openapi /__abide/openapi.json',
        bridge: '404 bridge /__abide/bridge',
        bundle: `200 abide ${entry}`,
        alias: '200 file /robots.txt',
    })
    const mcp = await Bun.fetch(`${base}/docs/__abide/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-gate': 'closed' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(mcp.headers.get('x-lane')).toBe('mcp /__abide/mcp')
})

// 37.16 — THE SOCKET MUX'S UPGRADE IS ITS OWN LANE, so a gate can close it apart from every page and
// handler. THE REVERT: answer `'abide'` for the upgrade in `laneOf`; the gated socket opens.
test('the socket upgrade is the socket lane — 37.16', async () => {
    const dir = temporaryModule({
        'client.ts': `const [base, gate] = process.argv.slice(2)
const ws = new WebSocket(base.replace('http', 'ws') + '/docs/__abide/socket', {
    headers: gate === '' ? {} : { 'x-gate': gate },
})
const opened = await new Promise((done) => {
    ws.onopen = () => done(true)
    ws.onerror = () => done(false)
})
ws.close()
console.log(JSON.stringify(opened))
`,
    })
    const opens = (gate: string): Promise<boolean> =>
        lastLinePrinted<boolean>(['bun', `${dir}/client.ts`, base, gate])
    expect(await opens('')).toBe(true)
    expect(await opens('sockets')).toBe(false)
})
