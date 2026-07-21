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
    test('discovers rpc route names, page paths, and the app middleware export', async () => {
        const loaded = await loadApp(FIXTURE_DIR)

        const routes = loaded.routes
        if (routes === undefined) throw new Error('expected loaded routes')
        expect(Object.keys(routes)).toEqual(['greet'])
        const greetRoute = routes.greet
        if (greetRoute === undefined) throw new Error('expected greet route')
        expect(greetRoute.__rpc.read).toBe(true)

        const pages = loaded.pages
        if (pages === undefined) throw new Error('expected loaded pages')
        expect(Object.keys(pages).sort()).toEqual(['/', '/about'])
        expect(pages['/']).toContain('greet')

        // TODO #7: layout.abide files are discovered and keyed by their directory route prefix.
        const layouts = loaded.layouts
        if (layouts === undefined) throw new Error('expected loaded layouts')
        expect(Object.keys(layouts)).toEqual(['/'])
        expect(layouts['/']).toContain('children()')

        expect(Array.isArray(loaded.middleware)).toBe(true)
        expect(loaded.middleware).toEqual([])

        expect(loaded.sockets).toEqual({})
    })

    test('the loaded config boots a working app: rpc + SSR pages', async () => {
        const loaded = await loadApp(FIXTURE_DIR)
        const app = createTestApp(loaded)
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
})
