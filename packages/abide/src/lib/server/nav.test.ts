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
    const app = createTestApp({
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
    const app = createTestApp({
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
    const app = createTestApp({
        pages: {
            '/users/[id]':
                "<script>import { route } from 'abide/shared/route'</script><span>{route().params.id}</span>",
        },
    })

    const response = await app.fetch('/users/99', { headers: { 'Abide-Nav': '/' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/jsonl')
    expect(response.headers.get('vary')).toBe('Abide-Nav')

    const envelope = await parseSoftNav(response)
    expect(stripAnchors(envelope.html)).toContain('<span>99</span>')
    expect(envelope.html).not.toContain('<!doctype html>')
    expect(envelope.html).not.toContain('__abide-app')
    expect(envelope.seed).toEqual({})
    expect(envelope.url).toBe('/users/99')

    await app.stop()
})

test('without the Abide-Nav header the same route returns the full document', async () => {
    const app = createTestApp({
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
    expect(() => url('/users/[id]', {})).toThrow()
})
