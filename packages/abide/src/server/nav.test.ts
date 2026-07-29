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
import { GET } from './GET.ts'

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
    // Read-free page → no `reads`; the soft-nav seed still carries THIS nav request's per-request
    // ambients — its trace (CO2.3), which is how the client's `trace()` follows a navigation instead of
    // freezing on the first load, and its identity (AU3), so a nav whose middleware resolved someone
    // else re-adopts rather than leaving the tab on the identity it loaded with.
    const seed = envelope.seed as { trace?: string; identity?: { authenticated: boolean } }
    expect(Object.keys(seed).sort()).toEqual(['identity', 'trace'])
    expect(seed.trace).toBe(response.headers.get('traceresponse') ?? '')
    expect(seed.identity).toMatchObject({ authenticated: false })
    expect(envelope.url).toBe('/users/99')

    await app.stop()
})

// C6.2 / NAV_HEADERS: how deep a graft the ROUTE TABLE allows and how deep a graft the LIVE PAGE can
// take are different questions. The server can only answer the first; `Abide-Nav-Keep` is the client
// answering the second, and it WINS — one number, one derivation. The two used to be derived
// independently and reconciled at runtime, with the client hard-loading on a disagreement.
test('Abide-Nav-Keep decides the shared-layout depth: a client keeping nothing gets the whole tree', async () => {
    const app = await createTestApp({
        layouts: { '/': '<div class="chrome">{children()}</div>' },
        pages: { '/a': '<p>A</p>', '/b': '<p>B</p>' },
    })

    // Both routes sit under the root layout, so the server's own derivation keeps it and ships only the
    // diverging page for the client to graft into the live one.
    const grafting = await parseSoftNav(await app.fetch('/b', { headers: { 'Abide-Nav': '/a' } }))
    expect(grafting.sharedLevels).toBe(1)
    expect(grafting.html).not.toContain('chrome')

    // The same nav from a client that can keep nothing — no live chain, or one grafted but not yet
    // claimed. The ceiling wins and the layout comes back, because this client is going to replace its
    // whole container and a bare `<p>B</p>` would drop the chrome entirely.
    const whole = await parseSoftNav(
        await app.fetch('/b', { headers: { 'Abide-Nav': '/a', 'Abide-Nav-Keep': '0' } }),
    )
    expect(whole.sharedLevels).toBe(0)
    expect(whole.html).toContain('chrome')
    expect(whole.html).toContain('<p>B</p>')

    await app.stop()
})

test('a declared depth is clamped to the route’s own, and a malformed one falls back to the derivation', async () => {
    const app = await createTestApp({
        layouts: { '/': '<div class="chrome">{children()}</div>' },
        pages: { '/a': '<p>A</p>', '/b': '<p>B</p>' },
    })

    // `/b` sits under exactly one layout, so a client claiming to keep five is claiming levels that do
    // not exist. Unclamped that slices past the end and ships an empty shell; clamped it means "keep
    // everything there is", which is the only thing it could have meant.
    const over = await parseSoftNav(
        await app.fetch('/b', { headers: { 'Abide-Nav': '/a', 'Abide-Nav-Keep': '5' } }),
    )
    expect(over.sharedLevels).toBe(1)
    expect(over.html).toContain('<p>B</p>')

    // A value that isn't a count says nothing, so the router's own derivation stands — which renders
    // MORE of the tree than a bad parse might have, and more is always placeable. Note `''`: `Number('')`
    // is `0`, so an empty header would otherwise read as the most consequential value the field has.
    for (const keep of ['banana', '-1', '', '1.5']) {
        const envelope = await parseSoftNav(
            await app.fetch('/b', { headers: { 'Abide-Nav': '/a', 'Abide-Nav-Keep': keep } }),
        )
        expect(envelope.sharedLevels).toBe(1)
        expect(envelope.html).toContain('<p>B</p>')
    }

    await app.stop()
})

// The point of the client winning: it can keep LESS than the route table permits. Both routes share the
// root layout, so the derivation says 1 — but a client with nothing mounted, or a mount grafted and not
// yet claimed, can keep 0, and the server has no way to know that.
test('a client may declare a SHALLOWER keep than the route table permits', async () => {
    const app = await createTestApp({
        layouts: { '/': '<div class="chrome">{children()}</div>' },
        pages: { '/a': '<p>A</p>', '/b': '<p>B</p>' },
    })

    const derived = await parseSoftNav(await app.fetch('/b', { headers: { 'Abide-Nav': '/a' } }))
    expect(derived.sharedLevels).toBe(1)

    const shallower = await parseSoftNav(
        await app.fetch('/b', { headers: { 'Abide-Nav': '/a', 'Abide-Nav-Keep': '0' } }),
    )
    expect(shallower.sharedLevels).toBe(0)
    expect(shallower.html).toContain('chrome')

    await app.stop()
})

// What the ceiling is FOR on a same-pattern nav, stated as the seed contents rather than as HTML: the
// client keeps its whole chain there, so it wants the confirm only for its seed — and a seed can only
// carry reads from levels the server actually RAN. A same-pattern nav skips every layout by default
// (from == to, so the derived depth is that route's full depth), which is why a layout's route-
// independent read had nowhere to come from and kept painting its first-paint value.
test('a same-pattern nav seeds only the PAGE by default, and the layouts too when keep is 0', async () => {
    const app = await createTestApp({
        routes: {
            chrome: GET(() => ({ where: 'layout' })),
            body: GET(() => ({ where: 'page' })),
        },
        layouts: {
            '/': "<script>import chrome from 'abide-rpc:chrome'</script><div>{(await chrome()).where}{children()}</div>",
        },
        pages: {
            '/a': "<script>import body from 'abide-rpc:body'</script><p>{(await body()).where}</p>",
        },
    })

    const names = (envelope: { seed: unknown }): string[] =>
        ((envelope.seed as { reads?: { name: string }[] }).reads ?? [])
            .map((read) => read.name)
            .sort()

    // Default: the layout is kept, so it is not re-rendered — and its read is therefore absent.
    const kept = await parseSoftNav(await app.fetch('/a', { headers: { 'Abide-Nav': '/a' } }))
    expect(kept.sharedLevels).toBe(1)
    expect(names(kept)).toEqual(['body'])

    // `keep: 0` — what the client sends when the nav is to the URL it is already on. The whole tree
    // renders, so the layout's read runs and reaches the seed the client replays.
    const whole = await parseSoftNav(
        await app.fetch('/a', { headers: { 'Abide-Nav': '/a', 'Abide-Nav-Keep': '0' } }),
    )
    expect(whole.sharedLevels).toBe(0)
    expect(names(whole)).toEqual(['body', 'chrome'])

    await app.stop()
})

test('a nav response varies on BOTH nav headers — each picks a different representation', async () => {
    const app = await createTestApp({
        layouts: { '/': '<div class="chrome">{children()}</div>' },
        pages: { '/a': '<p>A</p>', '/b': '<p>B</p>' },
    })

    // `Abide-Nav` picks document-vs-frame-stream; `Abide-Nav-Keep` picks how much tree the stream
    // carries. A cache keyed on only the first could hand a whole-tree render to a client that asked for
    // a suffix, or the reverse — so both representations declare both.
    const soft = await app.fetch('/b', { headers: { 'Abide-Nav': '/a' } })
    const first = await app.fetch('/b')
    for (const response of [soft, first]) {
        const vary = response.headers.get('vary') ?? ''
        expect(vary).toContain('Abide-Nav')
        expect(vary).toContain('Abide-Nav-Keep')
    }

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
