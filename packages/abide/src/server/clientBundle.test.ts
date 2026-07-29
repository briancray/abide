// M3b — the client build + bootstrap. The router code-splits the app into a content-hashed loader
// entry + per-route chunks + shared chunks (Bun.build `splitting`), served under /__abide/chunk/; every
// SSR'd page injects `<script type="module" src="/__abide/chunk/loader-<hash>.js">`. The mount path
// itself is proven directly via `bootstrapPage` under happy-dom (executing the full split output in
// happy-dom is out of scope — happy-dom doesn't resolve ESM dynamic imports; the docs Playwright e2e is
// the real split-hydration gate — we assert here that it built, split, and serves).

import { expect, test } from 'bun:test'
import { GET } from '../server/GET.ts'
import { buildClient } from '../server/internal/clientBundle.ts'
import type { AppConfig } from '../server/internal/router.ts'
import { createTestApp } from '../test/createTestApp.ts'
import { bootstrapPage } from '../ui/internal/bootstrap.ts'
import { loadEmitted } from '../ui/internal/emit.ts'

// Yield to the microtask queue so batched reactive effects flush (mirrors assemble.test.ts).
function tick(): Promise<void> {
    return Promise.resolve()
}

// Concatenate every built JS file (loader entry + all chunks) — the whole app's client code across the
// split graph.
async function allClientJs(config: AppConfig): Promise<string> {
    const build = await buildClient(config)
    let js = ''
    const decoder = new TextDecoder()
    for (const [name, asset] of build.files)
        if (name.endsWith('.js')) js += `${decoder.decode(asset.identity)}\n`
    return js
}

test('the client builds, code-splits, and serves content-hashed chunks', async () => {
    const config: AppConfig = {
        routes: { greet: GET(({ name }: { name: string }) => `hi ${name}`) },
        pages: {
            '/': "<script>import { state } from 'abide/shared/state'; let title = state('Home')</script><h1>{title}</h1>",
        },
    }

    const build = await buildClient(config)
    // The loader entry boots the app; the page's emitted mount lives in a code-split CHUNK, not the entry.
    const entry = build.files.get(build.entry)
    if (entry === undefined) throw new Error('no loader entry')
    const loader = new TextDecoder().decode(entry.identity)
    expect(loader).toContain('bootstrapApp')
    expect(loader).toContain('() => import(') // per-pattern lazy chunk loaders

    const js = await allClientJs(config)
    // "Home" is the page's `state('Home')` initializer, carried inside the emitted mount (in its chunk),
    // so its presence proves the compiled client code (not raw source) reached the split output.
    expect(js).toContain('Home')
    // The runtime AOT client mount path is present (its helpers) …
    expect(js).toContain('interpolate')
    // … and the build-time `.abide` interpreter is NOT (no re-parse / re-compile in the browser).
    expect(js).not.toContain('compileClient')
    expect(js).not.toContain('mountPrepared')

    // Served under /__abide/chunk/ with an immutable (content-addressed) cache header.
    const app = await createTestApp(config)
    const response = await app.fetch(`/__abide/chunk/${build.entry}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/javascript')
    expect(response.headers.get('cache-control')).toContain('immutable')
    await app.stop()
})

// CO2.2. `log` labels its default channel with the app name and qualifies a bare
// `log.channel('cards')` under it — but a browser has no environment to read the name from, so the
// build has to carry it. Un-seeded, a client line says `abide:cards` where the server line for the
// same channel says `myapp:cards`: one channel, two names, on an isomorphic primitive.
test('the loader entry bakes the app name for the browser half of `log`', async () => {
    const previous = Bun.env.ABIDE_APP_NAME
    Bun.env.ABIDE_APP_NAME = 'bakedapp'
    try {
        const build = await buildClient({ pages: { '/': '<h1>hi</h1>' } })
        const entry = build.files.get(build.entry)
        if (entry === undefined) throw new Error('no loader entry')
        const loader = new TextDecoder().decode(entry.identity)
        expect(loader).toContain('__ABIDE_APP_NAME__')
        expect(loader).toContain('bakedapp')
    } finally {
        if (previous === undefined) delete Bun.env.ABIDE_APP_NAME
        else Bun.env.ABIDE_APP_NAME = previous
    }
})

test("the SSR'd page HTML injects the content-hashed loader script tag", async () => {
    const app = await createTestApp({
        pages: { '/': '<h1>ok</h1>' },
    })

    const response = await app.fetch('/')
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toMatch(
        /<script type="module" src="\/__abide\/chunk\/loader-[a-z0-9]+\.js"><\/script>/,
    )

    await app.stop()
})

test("bootstrapPage HYDRATES the SSR'd page into #__abide-app (claims nodes, working reactivity)", async () => {
    const source =
        "<script>import { state } from 'abide/shared/state'; let count = state(0)</script><button onclick={() => count++}>+</button><span>{count}</span>"
    // PR7: bootstrapPage now CLAIMS the server DOM instead of clearing + fresh-mounting. Render the real
    // anchored SSR HTML into the container so hydration has DOM to attach to.
    const { render, hydrate } = await loadEmitted(source)
    const html = await render({ state: (v: unknown) => Object.assign(() => v, { set() {} }) })
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

test("a page's CSS import is bundled, served content-hashed under /__abide/chunk/, and linked", async () => {
    // A page that side-effect-imports a real stylesheet. The client build must resolve the relative
    // specifier against the page's source dir (pageDirs), bundle the CSS, serve it (hashed), and link it.
    const dir = `/tmp/abide-css-${crypto.randomUUID()}`
    await Bun.write(`${dir}/page.css`, '.abide-proof { color: rebeccapurple; }\n')

    const app = await createTestApp({
        pages: { '/': '<script>import \'./page.css\'</script><h1 class="abide-proof">hi</h1>' },
        pageDirs: { '/': dir },
    })

    // The SSR'd document links the content-hashed stylesheet (only emitted because there IS bundled CSS).
    const doc = await (await app.fetch('/')).text()
    const link = doc.match(
        /<link rel="stylesheet" href="(\/__abide\/chunk\/style-[a-z0-9]+\.css)">/,
    )
    if (link === null) throw new Error(`no hashed stylesheet link in document:\n${doc}`)

    // That URL serves the bundled CSS (the class rule survived bundling) immutable.
    const cssResponse = await app.fetch(link[1] as string)
    expect(cssResponse.status).toBe(200)
    expect(cssResponse.headers.get('content-type')).toContain('text/css')
    expect(cssResponse.headers.get('cache-control')).toContain('immutable')
    const css = await cssResponse.text()
    expect(css).toContain('.abide-proof')
    // Bun's CSS pipeline normalises the color (rebeccapurple → #639); assert the property survived.
    expect(css).toContain('color')

    await app.stop()
})

test('no CSS import → no cssFile and no stylesheet link in the document', async () => {
    const config: AppConfig = { pages: { '/': '<h1>plain</h1>' } }
    const build = await buildClient(config)
    expect(build.cssFile).toBeUndefined()

    const app = await createTestApp(config)
    const doc = await (await app.fetch('/')).text()
    expect(doc).not.toContain('rel="stylesheet"')
    expect(doc).not.toContain('.css')

    await app.stop()
})

test('tree-shaking: the loader carries specs only for RPCs a page imports', async () => {
    // Two RPCs registered (alpha, bravo); the single page imports ONLY alpha. bravo must not reach the
    // loader's RPC_SPECS — un-imported RPCs are tree-shaken out. Specs live in the loader entry.
    const config: AppConfig = {
        routes: {
            alpha: GET(() => 'a'),
            bravo: GET(() => 'b'),
        },
        pages: {
            '/': "<script>import alpha from '../../server/rpc/alpha'</script><p>{await alpha()}</p>",
        },
    }

    const build = await buildClient(config)
    const entry = build.files.get(build.entry)
    if (entry === undefined) throw new Error('no loader entry')
    const loader = new TextDecoder().decode(entry.identity)
    // alpha is imported → its spec (keyed by route name) is present; bravo is not.
    expect(loader).toContain('alpha')
    expect(loader).not.toContain('bravo')
})

// THE BILATERAL FIELDS ACTUALLY REACH THE LOADER.
//
// The wire spec used to be spelled six times — `RpcEntry`, this function's return type, its local, the
// `pageRegistry` type at the `registerPages` → `makeClientImports` boundary, `clientProxy`'s opts —
// with nothing connecting them, and the wire itself is JSON concatenated into the loader, so nothing
// type-checked the crossing either. It had already drifted: `throttle`/`debounce`, the most recent
// fields added, were absent from the `pageRegistry` copy and rode through as untyped extra properties.
//
// One `RpcSpec` now connects the ends at the type level. This asserts the other end — that a field
// declared bilateral is EMITTED — because a shared type cannot catch an emitter that stops writing one.
test('the loader carries every bilateral policy field the author configured', async () => {
    const build = await buildClient({
        routes: {
            tuned: GET(() => 'v', {
                memo: { ttl: 5_000, tags: ['t'], debounce: 250 },
                timeout: 9_000,
            }),
        },
        pages: {
            '/': "<script>import tuned from '../../server/rpc/tuned'</script><p>{await tuned()}</p>",
        },
    })
    const entry = build.files.get(build.entry)
    if (entry === undefined) throw new Error('no loader entry')
    const loader = new TextDecoder().decode(entry.identity)
    // Parsed rather than substring-matched: the emitted map is a JS object literal whose formatting is
    // the bundler's business, and the claim is about the FIELDS.
    const source = /var RPC_SPECS = (\{[\s\S]*?\});/.exec(loader)?.[1]
    if (source === undefined) throw new Error('no RPC_SPECS in the loader entry')
    const specs = new Function(`return ${source}`)() as Record<string, Record<string, unknown>>
    expect(specs.tuned).toMatchObject({
        method: 'GET',
        read: true,
        ttl: 5_000,
        tags: ['t'],
        debounce: 250,
        timeout: 9_000,
    })
})
