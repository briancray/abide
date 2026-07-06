import { describe, expect, test } from 'bun:test'
import type { RemoteRoutes } from '../src/lib/server/rpc/types/RemoteRoutes.ts'
import type { Pages } from '../src/lib/ui/types/Pages.ts'
import { bootTestServer } from './support/bootTestServer.ts'

/* The params fixture renders JSON.stringify(page.params) inside <p data-params>. */
function renderedParams(html: string): Record<string, string> {
    const match = html.match(/data-params[^>]*>(.*?)<\/p>/s)
    return JSON.parse(
        (match?.[1] ?? '{}').replaceAll('&quot;', '"').replaceAll('&lbrace;', '{'),
    ) as Record<string, string>
}

const paramsPage = () => import('./support/fixtures/pages/params.abide')

describe('server route dispatch', () => {
    test('a [name] param percent-decodes into page.params', async () => {
        const pages: Pages = { '/media/[id]': paramsPage }
        const { origin, stop } = await bootTestServer({ pages })
        try {
            const html = await (await fetch(`${origin}/media/a%20b`)).text()
            expect(renderedParams(html)).toEqual({ id: 'a b' })
        } finally {
            stop()
        }
    })

    test('a [...rest] catch-all captures remaining segments, decoded per segment', async () => {
        const pages: Pages = { '/files/[...rest]': paramsPage }
        const { origin, stop } = await bootTestServer({ pages })
        try {
            const html = await (await fetch(`${origin}/files/a/b%20c`)).text()
            expect(renderedParams(html)).toEqual({ rest: 'a/b c' })
        } finally {
            stop()
        }
    })

    test('a [...rest] catch-all matches zero segments as an empty value', async () => {
        const pages: Pages = { '/files/[...rest]': paramsPage }
        const { origin, stop } = await bootTestServer({ pages })
        try {
            const response = await fetch(`${origin}/files`)
            expect(response.status).toBe(200)
            expect(renderedParams(await response.text())).toEqual({ rest: '' })
        } finally {
            stop()
        }
    })

    test('an [[optional]] page route serves with and without the segment', async () => {
        const pages: Pages = { '/docs/[[page]]': paramsPage }
        const { origin, stop } = await bootTestServer({ pages })
        try {
            const absent = await fetch(`${origin}/docs`)
            expect(absent.status).toBe(200)
            expect(renderedParams(await absent.text())).toEqual({})
            const present = await fetch(`${origin}/docs/intro`)
            expect(present.status).toBe(200)
            expect(renderedParams(await present.text())).toEqual({ page: 'intro' })
        } finally {
            stop()
        }
    })

    test('the more specific route wins over an [[optional]] sibling', async () => {
        const pages: Pages = { '/[[lang]]/about': paramsPage, '/about': paramsPage }
        const { origin, stop } = await bootTestServer({ pages })
        try {
            const html = await (await fetch(`${origin}/about`)).text()
            /* `/about` (all literals) must win — its params are empty; the optional
               route would have matched with lang absent, so {} alone can't tell them
               apart. `/en/about` proves the optional route still serves. */
            expect(renderedParams(html)).toEqual({})
            const optional = await (await fetch(`${origin}/en/about`)).text()
            expect(renderedParams(optional)).toEqual({ lang: 'en' })
        } finally {
            stop()
        }
    })

    test('a page route shadows a public/ file at the same path', async () => {
        const pages: Pages = { '/about': paramsPage }
        const publicBytes = Bun.gzipSync(new TextEncoder().encode('public file'))
        const { origin, stop } = await bootTestServer({
            pages,
            publicAssets: { '/about': new Uint8Array(publicBytes) },
        })
        try {
            const html = await (await fetch(`${origin}/about`)).text()
            expect(html).toContain('data-params')
            expect(html).not.toContain('public file')
        } finally {
            stop()
        }
    })

    test('a public/ file still serves where no page route matches', async () => {
        const publicBytes = Bun.gzipSync(new TextEncoder().encode('public file'))
        const { origin, stop } = await bootTestServer({
            pages: {},
            publicAssets: { '/readme.txt': new Uint8Array(publicBytes) },
        })
        try {
            expect(await (await fetch(`${origin}/readme.txt`)).text()).toBe('public file')
        } finally {
            stop()
        }
    })

    test('rpc dispatch and method mismatch survive the matcher', async () => {
        const rpc: RemoteRoutes = { '/rpc/echo': () => import('./support/fixtures/rpc/echo.ts') }
        const { origin, stop } = await bootTestServer({ rpc })
        try {
            const ok = await fetch(`${origin}/rpc/echo`)
            expect(ok.status).toBe(200)
            expect(await ok.json()).toEqual({ ok: true })
            const wrongMethod = await fetch(`${origin}/rpc/echo`, { method: 'POST' })
            expect(wrongMethod.status).toBe(405)
            expect(wrongMethod.headers.get('Allow')).toBe('GET')
        } finally {
            stop()
        }
    })

    test('a non-terminal [...rest] catch-all is rejected at boot', async () => {
        const pages: Pages = { '/docs/[...rest]/edit': paramsPage }
        expect(bootTestServer({ pages })).rejects.toThrow('catch-all must be the last segment')
    })

    test('non-canonical slashes redirect to the canonical page URL, query intact', async () => {
        const pages: Pages = { '/docs': paramsPage }
        const { origin, stop } = await bootTestServer({ pages })
        try {
            const trailing = await fetch(`${origin}/docs/?q=1`, { redirect: 'manual' })
            expect(trailing.status).toBe(308)
            expect(trailing.headers.get('Location')).toBe('/docs?q=1')
            /* Bun's HTTP layer collapses duplicate slashes before fetch runs, so
               `//docs` arrives already canonical and serves directly. */
            const doubled = await fetch(`${origin}//docs`, { redirect: 'manual' })
            expect(doubled.status).toBe(200)
        } finally {
            stop()
        }
    })

    test('a non-canonical path cannot reach a page behind an exact-match app.handle guard', async () => {
        const pages: Pages = { '/admin': paramsPage }
        const { origin, stop } = await bootTestServer({
            pages,
            app: {
                handle: async (req, next) => {
                    if (new URL(req.url).pathname === '/admin') {
                        return new Response('blocked', { status: 403 })
                    }
                    return next(req)
                },
            },
        })
        try {
            expect((await fetch(`${origin}/admin`)).status).toBe(403)
            /* The bypass shape: /admin/ used to slip past the guard (raw pathname)
               into the page (matched normalized). The redirect makes the retried
               request carry the canonical pathname the guard checks. */
            const slashed = await fetch(`${origin}/admin/`, { redirect: 'manual' })
            expect(slashed.status).toBe(308)
            expect((await fetch(`${origin}/admin/`)).status).toBe(403)
        } finally {
            stop()
        }
    })

    test('an unmatched URL falls through to the 404 path', async () => {
        const { origin, stop } = await bootTestServer({ pages: {} })
        try {
            const response = await fetch(`${origin}/nope`)
            expect(response.status).toBe(404)
        } finally {
            stop()
        }
    })
})
