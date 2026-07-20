// M3b — the client bundle + bootstrap. The router builds a browser JS bundle for the app's pages
// (Bun.build over a generated entry that inlines page sources + RPC specs) and serves it at
// /__abide/client.js; every SSR'd page injects a `<script type="module">` that loads it. The mount
// path itself is proven directly via `bootstrapPage` under happy-dom (executing the full Bun.build
// output in happy-dom is out of scope — we assert it built and is served).

import { expect, test } from 'bun:test'
import { GET } from '../server/GET.ts'
import { buildClientBundle } from '../server/internal/clientBundle.ts'
import { createTestApp } from '../test/createTestApp.ts'
import { bootstrapPage } from '../ui/internal/bootstrap.ts'
import { loadEmitted } from '../ui/internal/emit.ts'

// Yield to the microtask queue so batched reactive effects flush (mirrors assemble.test.ts).
function tick(): Promise<void> {
    return Promise.resolve()
}

test('GET /__abide/client.js serves a non-empty JS bundle that built successfully', async () => {
    const app = createTestApp({
        routes: { greet: GET(({ name }: { name: string }) => `hi ${name}`) },
        pages: {
            '/': "<script>import { state } from 'abide/ui/state'; let title = state('Home')</script><h1>{title}</h1>",
        },
    })

    const response = await app.fetch('/__abide/client.js')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/javascript')

    const body = await response.text()
    expect(body.length).toBeGreaterThan(0)
    // Bun.build succeeded and bundled the app boot path + the page's AOT-emitted client mount. PR7: the
    // page is no longer inlined as `.abide` source and re-parsed in the browser — it ships as an emitted
    // ES module. "Home" is the page's `state('Home')` initializer, carried inside that emitted mount, so
    // its presence proves the compiled client code (not raw source) reached the bundle.
    expect(body).toContain('bootstrapApp')
    expect(body).toContain('Home')
    // The runtime AOT client mount path is present (its helpers) …
    expect(body).toContain('interpolate')
    // … and the build-time `.abide` interpreter is NOT (no re-parse / re-compile in the browser).
    expect(body).not.toContain('compileClient')
    expect(body).not.toContain('mountPrepared')

    await app.stop()
})

test("the SSR'd page HTML injects the client bundle script tag", async () => {
    const app = createTestApp({
        pages: { '/': '<h1>ok</h1>' },
    })

    const response = await app.fetch('/')
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('<script type="module" src="/__abide/client.js"></script>')

    await app.stop()
})

test("bootstrapPage HYDRATES the SSR'd page into #__abide-app (claims nodes, working reactivity)", async () => {
    const source =
        "<script>import { state } from 'abide/ui/state'; let count = state(0)</script><button onclick={() => count++}>+</button><span>{count}</span>"
    // PR7: bootstrapPage now CLAIMS the server DOM instead of clearing + fresh-mounting. Render the real
    // anchored SSR HTML into the container so hydration has DOM to attach to.
    const { render, hydrate } = await loadEmitted(source)
    const html = await render({ state: (v: unknown) => ({ read: () => v, write() {} }) })
    document.body.innerHTML = `<div id="__abide-app">${html}</div>`

    const container = document.getElementById('__abide-app')
    if (container === null) throw new Error('expected #__abide-app container')
    // Capture the server-rendered nodes BEFORE hydration so we can prove they are CLAIMED (same object),
    // not recreated.
    const serverButton = container.querySelector('button')
    if (serverButton === null) throw new Error('expected server-rendered <button>')
    const serverSpan = container.querySelector('span')
    if (serverSpan === null) throw new Error('expected server-rendered <span>')

    const cleanup = bootstrapPage(hydrate, {})

    // Attach proof: the SAME server nodes survive hydration (no container clear, no recreate).
    expect(container.querySelector('button')).toBe(serverButton)
    expect(container.querySelector('span')).toBe(serverSpan)

    const span = container.querySelector('span')
    if (span === null) throw new Error('expected <span> after hydration')
    expect(span.textContent).toBe('0') // server value trusted (no repaint on pass 1)

    // Interactivity works on the claimed node — the click increments in place.
    serverButton.click()
    await tick()
    expect(span.textContent).toBe('1')
    expect(container.querySelector('span')).toBe(serverSpan) // still the same node, mutated in place

    cleanup()
    document.body.innerHTML = ''
})

test("a page's CSS import is bundled, served at /__abide/client.css, and linked in the document", async () => {
    // A page that side-effect-imports a real stylesheet. The client bundle must resolve the relative
    // specifier against the page's source dir (pageDirs), bundle the CSS, serve it, and link it.
    const dir = `/tmp/abide-css-${crypto.randomUUID()}`
    await Bun.write(`${dir}/page.css`, '.abide-proof { color: rebeccapurple; }\n')

    const app = createTestApp({
        pages: { '/': '<script>import \'./page.css\'</script><h1 class="abide-proof">hi</h1>' },
        pageDirs: { '/': dir },
    })

    // The stylesheet route serves the bundled CSS (the class rule survived bundling).
    const cssResponse = await app.fetch('/__abide/client.css')
    expect(cssResponse.status).toBe(200)
    expect(cssResponse.headers.get('content-type')).toContain('text/css')
    const css = await cssResponse.text()
    expect(css).toContain('.abide-proof')
    // Bun's CSS pipeline normalises the color (rebeccapurple → #639); assert the property survived.
    expect(css).toContain('color')

    // The SSR'd document links the stylesheet (only emitted because there IS bundled CSS).
    const docResponse = await app.fetch('/')
    const doc = await docResponse.text()
    expect(doc).toContain('<link rel="stylesheet" href="/__abide/client.css">')

    await app.stop()
})

test('no CSS import → empty client.css and no stylesheet link in the document', async () => {
    const app = createTestApp({ pages: { '/': '<h1>plain</h1>' } })

    const css = await (await app.fetch('/__abide/client.css')).text()
    expect(css).toBe('')

    const doc = await (await app.fetch('/')).text()
    expect(doc).not.toContain('/__abide/client.css')

    await app.stop()
})

test('tree-shaking: the bundle carries specs only for RPCs a page imports', async () => {
    // Two RPCs registered (alpha, bravo); the single page imports ONLY alpha. bravo must not reach the
    // client bundle's RPC_SPECS — un-imported RPCs are tree-shaken out.
    const config = {
        routes: {
            alpha: GET(() => 'a'),
            bravo: GET(() => 'b'),
        },
        pages: {
            '/': "<script>import alpha from '../../server/rpc/alpha'</script><p>{await alpha()}</p>",
        },
    }

    const bundle = await buildClientBundle(config)
    // alpha is imported → its spec (keyed by route name) is present; bravo is not.
    expect(bundle).toContain('alpha')
    expect(bundle).not.toContain('bravo')
})
