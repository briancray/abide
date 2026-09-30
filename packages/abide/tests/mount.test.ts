// 16.11, 36.11 — AN APP SERVED UNDER A SUB-PATH, set by `APP_URL` alone: the same build, every address
// resolved against the mount at run time (spawned, for `serve.test.ts`'s reason).

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const PAGE = `<script>
import { reactive, url } from 'abide'
import { getInvoice } from '#server/rpc/invoices.ts'
import '#ui/face.css'

const invoice = reactive(() => getInvoice({ id: '4' }))
</script>

<main><a id="link" href={url('/invoices/[id]', { id: 4 })}>four</a><p id="total">{invoice().total}</p></main>`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    process.env.APP_URL = 'http://example.test/docs/'
    ;({ base, stop } = await serveApp({
        'ui/pages/page.abide': PAGE,
        'ui/pages/invoices/[id]/page.abide': `<script>
import { route } from 'abide'
</script>

<main>an invoice at <b id="at">{route.url().pathname}</b></main>`,
        'ui/app.html': `<!doctype html><html><head><meta charset="utf-8"><link rel="preload" href="/fonts/face.woff2" as="font"><link rel="preconnect" href="//cdn.example.test"></head><body></body></html>`,
        'ui/face.css': `@font-face { font-family: Face; src: url('/fonts/face.woff2'); }\n`,
        'ui/public/fonts/face.woff2': 'a face',
        'ui/public/robots.txt': 'User-agent: *\n',
        'server/rpc/invoices.ts': `import { GET, reactive } from 'abide/server'\n\nexport const getInvoice = GET(async ({ id }: { id: string }) => ({ id, total: 99 }))\n\nexport const count = GET(reactive({ open: 3 }, { global: true }))\n`,
    }))
    delete process.env.APP_URL
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// 16.11 — THE DOCUMENT NAMES THE MOUNT AND LOADS EVERYTHING FROM UNDER IT, and an address `url` built
// is under it too. THE REVERT: leave `clientTags` on `CLIENT_ADDRESS` bare; the entry is asked for at
// the root, where nothing of this app's is.
test('a page under the mount loads from under it — 16.11', async () => {
    const answer = await Bun.fetch(`${base}/docs/`)
    expect(answer.status).toBe(200)
    const html = await answer.text()
    expect(html).toContain('<meta name="abide-mount" content="/docs">')
    expect(html).toMatch(
        /<script type="module" src="\/docs\/__abide\/client\/entry-[^"]+\.js">/,
    )
    expect(html).toContain('<a id="link" href="/docs/invoices/4">four</a>')
    // 41.20 — the early call is the address the browser's own call is made at.
    expect(html).toContain('/docs/__abide/rpc/invoices/getInvoice?id=4')
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
        await (
            await Bun.fetch(`${base}/docs/__abide/rpc/invoices/getInvoice?id=4`)
        ).json(),
    ).toEqual({
        id: '4',
        total: 99,
    })
    expect(await (await Bun.fetch(`${base}/docs/robots.txt`)).text()).toBe(
        'User-agent: *\n',
    )
})

// 18.2, 36.11 — THE MUX ANSWERS UNDER THE MOUNT, and an address named as the browser's wrapper resolved
// it — a path under the mount, or a whole URL — reaches the handler it names.
test('the mux answers under the mount, for an address under it or a whole URL — 18.2, 36.11', async () => {
    const dir = temporaryModule({
        'client.ts': `const base = process.argv[2]
const frames: unknown[] = []
const ws = new WebSocket(base.replace('http', 'ws') + '/docs/__abide/socket')
ws.onmessage = (event) => frames.push(JSON.parse(String(event.data)))
await new Promise((done) => (ws.onopen = done))
ws.send(JSON.stringify({ op: 'sub', id: 1, address: '/docs/__abide/rpc/invoices/count' }))
ws.send(JSON.stringify({ op: 'sub', id: 2, address: base + '/docs/__abide/rpc/invoices/count' }))
await new Promise((done) => setTimeout(done, 150))
ws.close()
console.log(JSON.stringify(frames))
`,
    })
    const ran = Bun.spawn(['bun', `${dir}/client.ts`, base], { stdout: 'pipe' })
    const printed = await new Response(ran.stdout).text()
    const frames = JSON.parse(printed.trim().split('\n').at(-1) as string) as {
        op: string
        id: number
        value?: unknown
    }[]
    expect(frames.map((frame) => [frame.op, frame.id, frame.value])).toEqual([
        ['value', 1, { open: 3 }],
        ['value', 2, { open: 3 }],
    ])
})

// 16.11, 23.4 — A PAGE IS WHERE IT IS SERVED, on the server as in the browser: the request reaches the
// route with the mount taken off, and the browser's router arrives at `location`. THE REVERT: `arrive`
// the request's own URL in `answerRequest`; the server renders `/invoices/4` and the browser hydrates
// against `/docs/invoices/4`.
test('a page reads the address it is served at — 16.11, 23.4', async () => {
    const html = await (await Bun.fetch(`${base}/docs/invoices/4`)).text()
    expect(html).toMatch(/id="at">(<!--[^>]*-->)?\/docs\/invoices\/4</)
})

// 16.11, 36.11 — WHAT THE SHELL AND THE STYLESHEET NAME AT THE ROOT IS THE MOUNT'S. Neither is a
// template with a `url` to spell an address in, so the shell's `/…` is put under the mount as the
// document is prepared and the stylesheet's is written relative to the bundle it is served from.
// THE REVERTS: `shellUnderMount` returning the shell, and `stylesheetUnderMount` the sheet — both
// then name `/fonts/face.woff2`, the origin's root, where nothing of this app's is.
test('the shell and the stylesheet name a public file under the mount — 16.11, 36.11', async () => {
    const html = await (await Bun.fetch(`${base}/docs/`)).text()
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

// 16.11 — THE BARE MOUNT IS SENT TO ITS ROOT, which is where `url('/')` points: a document answered at
// `/docs` resolves a relative address against `/`, outside the app. A path, not a URL, so a proxy's
// origin is not the one written back. THE REVERT: drop the redirect from `belowMount`; `/docs` is a
// 200.
test('the bare mount is sent to its root — 16.11', async () => {
    const answer = await Bun.fetch(`${base}/docs?from=bar`, {
        redirect: 'manual',
    })
    expect(answer.status).toBe(308)
    expect(answer.headers.get('location')).toBe('/docs/?from=bar')
})
