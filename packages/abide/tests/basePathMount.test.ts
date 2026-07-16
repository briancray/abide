import { afterEach, describe, expect, test } from 'bun:test'
import type { Pages } from '../src/lib/ui/types/Pages.ts'
import { bootTestServer } from './support/bootTestServer.ts'

/*
End-to-end: APP_URL's pathname becomes the mount base, which createServer
rewrites into the shell's /_app refs and ships in __SSR__ for the client to
install. A shell carrying the framework asset refs the real app.html does, so
the rewrite has something to act on.
*/
const SHELL =
    '<!DOCTYPE html><html><head>' +
    '<link rel="stylesheet" href="/_app/client.css" /><!--ssr:head-->' +
    '</head><body><div id="app"><!--ssr:body--></div><!--ssr:state-->' +
    '<script type="module" src="/_app/client.js"></script></body></html>'

const pages: Pages = {
    '/': () => import('./support/fixtures/pages/home.abide'),
    '/where': () => import('./support/fixtures/pages/location.abide'),
}

function ssrState(html: string): Record<string, unknown> {
    const match = html.match(/<script type="application\/json" id="abide-ssr">(.+?)<\/script>/)
    return JSON.parse(match?.[1] ?? '{}')
}

/* The location fixture renders page.url.pathname inside <p data-page="location">. */
function renderedPathname(html: string): string | undefined {
    return html.match(/data-page="location"[^>]*>(.*?)<\/p>/s)?.[1]
}

const previousAppUrl = process.env.APP_URL

afterEach(() => {
    if (previousAppUrl === undefined) {
        delete process.env.APP_URL
    } else {
        process.env.APP_URL = previousAppUrl
    }
})

describe('APP_URL mount base', () => {
    test('prefixes the shell /_app refs and ships base in __SSR__', async () => {
        process.env.APP_URL = 'https://foo.com/v2'
        const { origin, stop } = await bootTestServer({ pages, shell: SHELL })
        try {
            const html = await (await fetch(`${origin}/`)).text()
            expect(html).toContain('src="/v2/_app/client.js"')
            expect(html).toContain('href="/v2/_app/client.css"')
            expect(html).not.toContain('"/_app/client.js"')
            expect(ssrState(html).base).toBe('/v2')
        } finally {
            stop()
        }
    })

    test('SSR page.url carries the mount base', async () => {
        process.env.APP_URL = 'https://foo.com/v2'
        const { origin, stop } = await bootTestServer({ pages, shell: SHELL })
        try {
            const html = await (await fetch(`${origin}/where`)).text()
            expect(renderedPathname(html)).toBe('/v2/where')
        } finally {
            stop()
        }
    })

    test('SSR page.url is the request pathname at root mount', async () => {
        delete process.env.APP_URL
        const { origin, stop } = await bootTestServer({ pages, shell: SHELL })
        try {
            const html = await (await fetch(`${origin}/where`)).text()
            expect(renderedPathname(html)).toBe('/where')
        } finally {
            stop()
        }
    })

    test('leaves /_app and __SSR__ untouched at root mount', async () => {
        delete process.env.APP_URL
        const { origin, stop } = await bootTestServer({ pages, shell: SHELL })
        try {
            const html = await (await fetch(`${origin}/`)).text()
            expect(html).toContain('src="/_app/client.js"')
            expect(ssrState(html).base).toBeUndefined()
        } finally {
            stop()
        }
    })
})
