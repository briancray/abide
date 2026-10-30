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
            'layout.abide': `<script>
import { url } from '@abide/abide'
</script>

<html><head><link rel="preload" href={url('/fonts/face.woff2')} as="font"><link rel="preconnect" href="//cdn.example.test"></head><body><slot/></body></html>`,
            'lib/face.css': `@font-face { font-family: Face; src: url('/fonts/face.woff2'); }\n`,
            'public/fonts/face.woff2': 'a face',
            'public/robots.txt': 'User-agent: *\n',
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
