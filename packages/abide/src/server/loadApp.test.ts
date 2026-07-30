import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { createTestApp, type TestApp } from '../test/createTestApp.ts'
import { loadApp } from './internal/loadApp.ts'

// SSR HTML now carries the client skeleton's comment anchors; strip them for structural assertions.
function stripAnchors(html: string): string {
    return html.replace(/<!--\[-->|<!--\]-->|<!---->/g, '')
}

const FIXTURE_DIR = join(import.meta.dir, '__fixtures__/app')

let running: TestApp | undefined

afterEach(async () => {
    if (running !== undefined) {
        await running.stop()
        running = undefined
    }
})

describe('loadApp — file-based app loader', () => {
    test('discovers rpc route names, page paths, and defaults middleware when app.ts is absent', async () => {
        const loaded = await loadApp(FIXTURE_DIR, { schemas: 'source' })

        const routes = loaded.routes
        if (routes === undefined) throw new Error('expected loaded routes')
        expect(Object.keys(routes)).toEqual(['greet'])
        const greetRoute = routes.greet
        if (greetRoute === undefined) throw new Error('expected greet route')
        expect(greetRoute.__rpc.read).toBe(true)

        const pages = loaded.pages
        if (pages === undefined) throw new Error('expected loaded pages')
        // `/shim` is the check-lane shim guard (see that page's own header) — a fixture page like any
        // other as far as discovery is concerned, which is why it belongs in this list rather than being
        // filtered out of it.
        expect(Object.keys(pages).sort()).toEqual(['/', '/about', '/shim'])
        expect(pages['/']).toContain('greet')

        // TODO #7: layout.abide files are discovered and keyed by their directory route prefix.
        const layouts = loaded.layouts
        if (layouts === undefined) throw new Error('expected loaded layouts')
        expect(Object.keys(layouts)).toEqual(['/'])
        expect(layouts['/']).toContain('<slot/>')

        // The fixture has no `app.ts` — middleware/lifecycle are optional, so the loader defaults
        // middleware to `[]` (app.ts absent → the early-return branch in loadAppModule).
        expect(Array.isArray(loaded.middleware)).toBe(true)
        expect(loaded.middleware).toEqual([])

        expect(loaded.sockets).toEqual({})
    })

    test('the loaded config boots a working app: rpc + SSR pages', async () => {
        const loaded = await loadApp(FIXTURE_DIR, { schemas: 'source' })
        const app = await createTestApp(loaded)
        running = app

        // /rpc/greet works via the loaded route.
        const greetRpc = app.rpc.greet
        if (greetRpc === undefined) throw new Error('expected greet rpc')
        expect(await greetRpc({ name: 'world' })).toBe('hi world')

        // "/" SSRs, and the page's in-template `greet` read resolves through the injected import map.
        const home = await app.fetch('/')
        expect(home.status).toBe(200)
        expect(home.headers.get('content-type')).toContain('text/html')
        const homeHtml = await home.text()
        expect(stripAnchors(homeHtml)).toContain('<h1>hi x</h1>')
        // The discovered root layout wraps the page (TODO #7): layout chrome precedes the page's <h1>.
        const stripped = stripAnchors(homeHtml)
        expect(stripped).toContain('<div class="app"><header>chrome</header>')
        expect(stripped.indexOf('<div class="app">')).toBeLessThan(
            stripped.indexOf('<h1>hi x</h1>'),
        )

        // "/about" resolves to its own SSR'd page.
        const about = await app.fetch('/about')
        expect(about.status).toBe(200)
        expect(await about.text()).toContain('about')
    })

    test('§11: a schemaless RPC gets its input schema derived from types at load', async () => {
        // `greet` is `export default GET(({ name }: { name: string }) => …)` — no hand-written schema.
        const loaded = await loadApp(FIXTURE_DIR, { schemas: 'source' })
        const greet = loaded.routes?.greet
        if (greet === undefined) throw new Error('expected greet route')
        // The derived input schema is merged onto the route's options (drives validation + OpenAPI).
        expect(greet.__rpc.options.schemas?.input).toEqual({
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
        })
        // …and the output schema too — `greet` returns `hi ${name}`, a string (§11.4).
        expect(greet.__rpc.options.schemas?.output).toEqual({ type: 'string' })

        const app = await createTestApp(loaded)
        running = app

        // OpenAPI advertises `name` as a flat, typed query param (the public affordance).
        const doc = (await (await app.fetch('/openapi.json')).json()) as {
            paths: Record<string, { get?: { parameters?: Array<{ name: string }> } }>
        }
        const params = doc.paths['/__abide/rpc/greet']?.get?.parameters ?? []
        expect(params.some((parameter) => parameter.name === 'name')).toBe(true)

        // The derived schema is runtime-enforced (§11.2): a bad-typed `name` → 422, handler never runs.
        const bad = await app.fetch(
            `/__abide/rpc/greet?__abide_args=${encodeURIComponent(JSON.stringify({ name: 123 }))}`,
        )
        expect(bad.status).toBe(422)

        // A flat query param still resolves and coerces through the same derived schema.
        const ok = await app.fetch('/__abide/rpc/greet?name=world')
        expect(ok.status).toBe(200)
        expect(await ok.json()).toBe('hi world')
    })
})
