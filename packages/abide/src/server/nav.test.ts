// M5b / C6 + C6-nav — route params and server-driven soft-nav.
//
// A page path may carry `[name]` segments (`/users/[id]`). A first-load nav request SSRs the full
// HTML document with route().params filled from the pathname. A nav request carrying the
// `Abide-Nav` header gets the inner page HTML + seed as a JSON envelope (soft-nav), with a
// `Vary: Abide-Nav` header. url() fills a page path's dynamic segments from params.

import { expect, test } from 'bun:test'
import { url } from '../shared/url.ts'
import { createTestApp } from '../test/createTestApp.ts'
import { parseSoftNav } from '../test/parseSoftNav.ts'

// SSR HTML now carries the client skeleton's comment anchors; strip them for structural assertions.
function stripAnchors(html: string): string {
    return html.replace(/<!--\[-->|<!--\]-->|<!---->/g, '')
}

test('SSRs a param route, filling route().params from the pathname', async () => {
    const app = await createTestApp({
        pages: {
            '/users/[id]':
                "<script>import { route } from 'abide/shared/route'</script><span>{route().params.id}</span>",
        },
    })

    const response = await app.fetch('/users/42')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    const body = await response.text()
    expect(body).toContain('<!doctype html>')
    expect(stripAnchors(body)).toContain('<span>42</span>')

    await app.stop()
})

test('an exact route beats a param route when both match', async () => {
    const app = await createTestApp({
        pages: {
            '/users/[id]':
                "<script>import { route } from 'abide/shared/route'</script><span>param:{route().params.id}</span>",
            '/users/new': '<span>exact</span>',
        },
    })

    const exact = await app.fetch('/users/new')
    expect(exact.status).toBe(200)
    expect(await exact.text()).toContain('<span>exact</span>')

    const param = await app.fetch('/users/7')
    expect(stripAnchors(await param.text())).toContain('<span>param:7</span>')

    await app.stop()
})

test('a soft-nav request (Abide-Nav header) returns a streamed JSONL envelope of inner HTML + seed', async () => {
    const app = await createTestApp({
        pages: {
            '/users/[id]':
                "<script>import { route } from 'abide/shared/route'</script><span>{route().params.id}</span>",
        },
    })

    const response = await app.fetch('/users/99', { headers: { 'Abide-Nav': '/' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/jsonl')
    // Keys the cache first-load vs soft-nav, and on identity (the default cache posture adds Cookie).
    const vary = response.headers.get('vary') ?? ''
    expect(vary).toContain('Abide-Nav')
    expect(vary).toContain('Cookie')

    const envelope = await parseSoftNav(response)
    expect(stripAnchors(envelope.html)).toContain('<span>99</span>')
    expect(envelope.html).not.toContain('<!doctype html>')
    expect(envelope.html).not.toContain('__abide-app')
    // Read-free page → no `reads`; the soft-nav seed still carries THIS nav request's trace (CO2.3),
    // which is how the client's `trace()` follows a navigation instead of freezing on the first load.
    const seed = envelope.seed as { trace?: string }
    expect(Object.keys(seed)).toEqual(['trace'])
    expect(seed.trace).toBe(response.headers.get('traceresponse') ?? '')
    expect(envelope.url).toBe('/users/99')

    await app.stop()
})

test('without the Abide-Nav header the same route returns the full document', async () => {
    const app = await createTestApp({
        pages: {
            '/users/[id]':
                "<script>import { route } from 'abide/shared/route'</script><span>{route().params.id}</span>",
        },
    })

    const response = await app.fetch('/users/99')
    expect(response.headers.get('content-type')).toContain('text/html')
    const body = await response.text()
    expect(body).toContain('<!doctype html>')
    expect(body).toContain('<div id="__abide-app">')

    await app.stop()
})

test('url() fills [name] segments from params', () => {
    expect(url('/users/[id]', { id: 7 })).toBe('/users/7')
    expect(url('/users/[id]/posts/[postId]', { id: 3, postId: 9 })).toBe('/users/3/posts/9')
    expect(() => url('/users/[id]', {} as unknown as { id: string })).toThrow()
})

test('url() appends a query string — (path, params, query) and (path, query)', () => {
    // Param path: third arg is the query.
    expect(url('/users/[id]', { id: 7 }, { tab: 'posts', page: 2 })).toBe(
        '/users/7?tab=posts&page=2',
    )
    // Static path: second arg is the query.
    expect(url('/search', { q: 'abide framework' })).toBe('/search?q=abide+framework')
    // Null/undefined values are dropped; arrays repeat the key.
    expect(url('/f', { a: undefined, b: null, c: [1, 2] })).toBe('/f?c=1&c=2')
    // An existing query merges with `&`; a trailing hash stays last.
    expect(url('/p?x=1#top', { y: 2 })).toBe('/p?x=1&y=2#top')
    // No/empty query leaves the path untouched.
    expect(url('/plain')).toBe('/plain')
    expect(url('/plain', {})).toBe('/plain')
})

test('SSRs an optional [[name]] route both with and without the segment', async () => {
    const app = await createTestApp({
        pages: {
            '/blog/[[page]]':
                "<script>import { route } from 'abide/shared/route'</script><span>page:{route().params.page}</span>",
        },
    })

    const withSegment = stripAnchors(await (await app.fetch('/blog/2')).text())
    expect(withSegment).toContain('<span>page:2</span>')

    const bare = stripAnchors(await (await app.fetch('/blog')).text())
    expect(bare).toContain('<span>page:</span>')

    await app.stop()
})

test('SSRs a rest [...name] route, exposing the captured segments', async () => {
    const app = await createTestApp({
        pages: {
            '/docs/[...path]':
                "<script>import { route } from 'abide/shared/route'</script><span>{route().params.path}</span>",
        },
    })

    const deep = stripAnchors(await (await app.fetch('/docs/a/b/c')).text())
    expect(deep).toContain('<span>a/b/c</span>')

    const single = stripAnchors(await (await app.fetch('/docs/intro')).text())
    expect(single).toContain('<span>intro</span>')

    await app.stop()
})

test('an exact page beats an optional/rest catch-all at the same prefix', async () => {
    const app = await createTestApp({
        pages: {
            '/docs/[...path]':
                "<script>import { route } from 'abide/shared/route'</script><span>rest:{route().params.path}</span>",
            '/docs/api': '<span>exact-api</span>',
        },
    })

    expect(stripAnchors(await (await app.fetch('/docs/api')).text())).toContain('exact-api')
    expect(stripAnchors(await (await app.fetch('/docs/x/y')).text())).toContain('rest:x/y')

    await app.stop()
})
