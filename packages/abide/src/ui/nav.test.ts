// CLIENT SOFT-NAV (M5b / C6-nav) — SPA navigation under happy-dom.
//
// Wires a small multi-page app directly into the client page registry (as the real client bundle
// entry does), then drives navigate()/link clicks/param nav and asserts: the target page mounts into
// #__abide-app, history is pushed, the soft-nav fetch carries the `Abide-Nav` header, and the reactive
// route() (name/url/params) updates. fetch is stubbed to return the server's soft-nav JSON envelope.

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { route } from '../shared/route.ts'
import { url } from '../shared/url.ts'
import { bootstrapApp } from './internal/bootstrap.ts'
import { clearClientProxyCache } from './internal/clientProxy.ts'
import { loadEmitted } from './internal/emit.ts'
import type { PageEntry, PageLoader } from './internal/pageRegistry.ts'
import { applyPatchFrame, handlePopState, mountPathname, navigate } from './navigate.ts'

// Wrap a resolved page entry as a code-split LOADER (what the client bundle registers now — TODO #6).
// Promise.resolve stands in for the chunk import; a mount is thus one microtask late (poll for it).
function loaderFor(entry: PageEntry): PageLoader {
    return () => Promise.resolve({ default: entry })
}

// The two-page (+ param) app: source keyed by route pattern, exactly like the client bundle ships one
// AOT-emitted `mount` per pattern.
const HOME_SOURCE = '<h1>Home page</h1>'
const ABOUT_SOURCE = '<h2>About page</h2>'
const USER_SOURCE =
    "<script>import { route } from 'abide/shared/route'</script><span>user {route().params.id}</span>"
// A page whose read depends on NOTHING a nav can move — no args, no `route()`. That is the shape the
// param/query nav's "the kept page's reads have already re-fetched reactively" premise does not cover:
// there is nothing for it to re-fire on, so only the confirm's seed can bring it a new value.
const COUNT_SOURCE =
    "<script>import counter from '$server/rpc/counter'</script><b>count {await counter()}</b>"

// Populated in beforeEach (emit is async — it instantiates each page's client module once). Keyed by
// route pattern → a code-split LOADER, exactly like the client bundle entry registers now.
let PAGES: Record<string, PageLoader>

// The inner HTML the server soft-nav envelope carries per path. PR7: the client now HYDRATES (claims)
// this HTML in place rather than fresh-mounting over it, so it must be the REAL anchored SSR output of
// the destination page (built from the emitted `render` below), not an anchor-free approximation.
let ENVELOPE_HTML: Record<string, string>
// The initial document body's inner HTML for `#__abide-app` — the SSR'd home page the app hydrates on
// first load. Built from the home page's emitted `render` so its anchors match the hydrate walk.
let HOME_HTML: string

let realFetch: typeof globalThis.fetch
let realPushState: typeof history.pushState
let fetchCalls: { url: string; nav: string | null; keep: string | null }[]
let pushCalls: unknown[][]
let cleanupApp: () => void
// The `seed` frame the stubbed soft-nav body carries, and what a bare `GET /__abide/rpc/counter`
// answers. Both are per-test knobs: a nav's seed is the only channel a param/query nav has to the live
// mount's memos, and the rpc value proves whether a read went to the network or came from that seed.
let navSeed: Record<string, unknown>
let counterValue: number

function tick(): Promise<void> {
    return Promise.resolve()
}

function container(): HTMLElement {
    const el = document.getElementById('__abide-app')
    if (!el) throw new Error('#__abide-app container not found')
    return el
}

// Move `location` without navigating — happy-dom's own hook (the preload deletes the global `window`,
// so reach it via document.defaultView). This is how a traversal is reproduced: the browser moves
// `location` first, THEN fires popstate.
function setUrl(href: string): void {
    ;(
        document.defaultView as unknown as { happyDOM: { setURL(url: string): void } }
    ).happyDOM.setURL(href)
}

beforeEach(async () => {
    const home = await loadEmitted(HOME_SOURCE)
    const about = await loadEmitted(ABOUT_SOURCE)
    const user = await loadEmitted(USER_SOURCE)
    const count = await loadEmitted(COUNT_SOURCE)
    PAGES = {
        '/': loaderFor({ mount: home.mount, hydrate: home.hydrate }),
        '/about': loaderFor({ mount: about.mount, hydrate: about.hydrate }),
        '/users/[id]': loaderFor({ mount: user.mount, hydrate: user.hydrate }),
        '/count': loaderFor({ mount: count.mount, hydrate: count.hydrate }),
    }

    // happy-dom defaults to about:blank (null origin); give it a real URL so location behaves like a
    // browser (the preload deletes the global `window`, so reach it via document.defaultView).
    setUrl('http://localhost/')

    // Build the REAL anchored SSR HTML the client hydrates. Static pages render context-free; the
    // param page reads route() during render, so seed the client route to /users/42 for it, then reset.
    HOME_HTML = await home.render({})
    routeAmbient.adopt({
        kind: 'nav',
        name: '/users/[id]',
        params: { id: '42' },
        url: new URL('http://localhost/users/42'),
        navigating: false,
    })
    const userHtml = await user.render({ route })
    routeAmbient.clear()
    counterValue = 1
    navSeed = {}
    ENVELOPE_HTML = {
        // `/` is here for the traversal case — a Back lands on it as a soft-nav DESTINATION, not just as
        // the first-load HTML the container is seeded with.
        '/': HOME_HTML,
        '/about': await about.render({}),
        '/users/42': userHtml,
        '/count': await count.render({ counter: async () => counterValue }),
    }

    // The document arrives SSR'd: seed the container with the home page's server HTML so first-load
    // hydration has real DOM to CLAIM (rather than an empty container to fresh-mount into).
    document.body.innerHTML = `<div id="__abide-app">${HOME_HTML}</div>`

    fetchCalls = []
    realFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url =
            typeof input === 'string'
                ? input
                : input instanceof URL
                  ? input.pathname
                  : (input as Request).url
        const headers = new Headers(init?.headers)
        const nav = headers.get('Abide-Nav')
        fetchCalls.push({ url, nav, keep: headers.get('Abide-Nav-Keep') })
        const parsed = new URL(url, location.origin)
        // A bare RPC call — what a client proxy does when its slot is COLD. Answering it separately is
        // what lets a test tell a seeded read from a re-fetched one.
        if (parsed.pathname.startsWith('/__abide/rpc/')) {
            return new Response(JSON.stringify(counterValue), {
                headers: { 'content-type': 'application/json' },
            })
        }
        const html = ENVELOPE_HTML[parsed.pathname] ?? '<p>missing</p>'
        // The streamed soft-nav body (PR4): a JSONL frame stream — a `shell` frame then a `seed` frame.
        // The real server sends pathname + search as the shell `url` so route().url keeps the query.
        const body = `${JSON.stringify({ kind: 'shell', html, url: parsed.pathname + parsed.search })}\n${JSON.stringify({ kind: 'seed', seed: navSeed })}\n`
        return new Response(body, { headers: { 'content-type': 'application/jsonl' } })
    }) as typeof globalThis.fetch

    pushCalls = []
    realPushState = history.pushState.bind(history)
    history.pushState = function (this: History, ...args: unknown[]): void {
        pushCalls.push(args)
        ;(realPushState as (...a: unknown[]) => void)(...args)
    } as typeof history.pushState

    cleanupApp = bootstrapApp(PAGES, { counter: { method: 'GET', read: true } })
    // The first-load mount is async now (it imports the current route's chunk — here a Promise.resolve),
    // so poll until the home page has hydrated into the container before the tests run.
    for (let i = 0; i < 50; i++) {
        if ((container().textContent ?? '').includes('Home page')) break
        await tick()
    }
})

afterEach(() => {
    cleanupApp()
    // A client proxy is one object per (base, rpc name) for the tab — module state, so without this one
    // test's warmed slots would be the next test's starting cache.
    clearClientProxyCache()
    globalThis.fetch = realFetch
    history.pushState = realPushState
    document.body.innerHTML = ''
    // The client-route holder is a module global; reset it so it doesn't leak into other test files
    // (where route() outside a request scope must still throw).
    routeAmbient.clear()
})

test('initial bootstrap mounts the page for the current location', () => {
    expect(container().textContent).toContain('Home page')
    expect(route().name).toBe('/')
    expect(route().url.pathname).toBe('/')
})

test('navigate() soft-loads the target page, pushes history, and updates route()', async () => {
    await navigate('/about')

    // The About page is mounted into the app container.
    expect(container().textContent).toContain('About page')
    expect(container().textContent).not.toContain('Home page')

    // History was pushed to the new path.
    expect(pushCalls.length).toBe(1)
    expect(location.pathname).toBe('/about')

    // The soft-nav fetch carried the Abide-Nav header naming the origin path.
    expect(fetchCalls.length).toBe(1)
    const firstCall = fetchCalls[0]
    if (!firstCall) throw new Error('expected a soft-nav fetch call')
    expect(firstCall.nav).toBe('/')

    // route() reflects the destination.
    expect(route().name).toBe('/about')
    expect(route().url.pathname).toBe('/about')
})

test('an internal <a> click is intercepted and drives a soft-nav (default prevented)', async () => {
    const anchor = document.createElement('a')
    anchor.setAttribute('href', '/about')
    anchor.textContent = 'About'
    document.body.appendChild(anchor)

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    anchor.dispatchEvent(event)

    // The click was intercepted (no full navigation) and a soft-nav fetch fired with the header.
    expect(event.defaultPrevented).toBe(true)
    expect(fetchCalls.length).toBe(1)
    const firstCall = fetchCalls[0]
    if (!firstCall) throw new Error('expected a soft-nav fetch call')
    expect(firstCall.nav).toBe('/')
    expect(firstCall.url).toContain('/about')

    // The soft-nav now consumes a streamed body (multiple async reads), so poll until it settles rather
    // than assuming a fixed number of microtask ticks.
    for (let i = 0; i < 50; i++) {
        if ((container().textContent ?? '').includes('About page')) break
        await tick()
    }
    expect(container().textContent).toContain('About page')

    anchor.remove()
})

test('soft-nav HYDRATES (claims) the swapped destination DOM in place — not a fresh mount', async () => {
    // Reproduce softLoad's two steps directly (fetch is exercised by the tests above): swap the
    // destination's REAL server HTML into the container, then run the same mountPathname the soft-nav
    // uses. PR7 unifies soft-nav onto the hydrate path (decision 6), so the destination page must CLAIM
    // the just-swapped nodes — the SAME object survives — rather than clearing + cloning fresh.
    const c = container()
    const envelope = ENVELOPE_HTML['/users/42']
    if (envelope === undefined) throw new Error('missing envelope HTML for /users/42')
    c.innerHTML = envelope // real anchored SSR of the param page
    const serverSpan = c.querySelector('span')
    if (!serverSpan) throw new Error('expected a <span> in the swapped SSR')

    const hydrated = await mountPathname('/users/42')
    expect(hydrated).toBe(true)

    // Attach proof: the destination span is the SAME node the innerHTML swap produced (claimed, not
    // recreated by a fresh mount), and it carries the server-rendered param value.
    expect(container().querySelector('span')).toBe(serverSpan)
    expect(serverSpan.textContent).toContain('user 42')
    expect(route().params.id).toBe('42')
})

test('param navigation updates route().params', async () => {
    await navigate('/users/42')

    expect(route().name).toBe('/users/[id]')
    expect(route().params.id).toBe('42')
    expect(route().url.pathname).toBe('/users/42')
    expect(container().textContent).toContain('user 42')
})

// Poll until the container's text matches — a soft-nav drains a streamed body and a `{await}` slot fills
// a tick after its read settles, so neither lands on a fixed number of ticks.
async function settleText(match: string): Promise<string> {
    for (let i = 0; i < 100; i++) {
        if ((container().textContent ?? '').includes(match)) break
        await tick()
    }
    return container().textContent ?? ''
}

test('a nav to the URL you are already on does not push a history entry', async () => {
    await navigate('/about')
    expect(pushCalls.length).toBe(1)

    // The re-navigation still runs (the server round-trip is what carries middleware + the confirm seed)
    // but it must not stack a second entry on the same URL — Back would then land where it started.
    await navigate('/about')
    expect(pushCalls.length).toBe(1)
    expect(location.pathname).toBe('/about')
    expect(fetchCalls.length).toBe(2)

    // A hash IS a move the reader can go Back from, so that one still pushes.
    await navigate('/about#section')
    expect(pushCalls.length).toBe(2)
})

test("a param/query nav replays the confirm's seed into the LIVE mount's memos", async () => {
    await navigate('/count')
    expect(await settleText('count 1')).toContain('count 1')

    // The nav's confirm is a full render of this route — the server ran the read on it. A read taking no
    // args and reading no `route()` has nothing to re-fire ON, so the seed is the only thing that can
    // bring the new value to a mount this nav deliberately keeps alive. `counterValue` stays 1, so a
    // value of 7 can ONLY have come from the seed and not from a re-fetch.
    navSeed = { reads: [{ name: 'counter', value: 7 }] }
    await navigate('/count')

    expect(await settleText('count 7')).toContain('count 7')
})

test('back/forward names the OUTGOING route in Abide-Nav, not the one it just landed on', async () => {
    await navigate('/about')
    expect(location.pathname).toBe('/about')

    // A traversal moves `location` BEFORE popstate fires, so the handler cannot read the outgoing route
    // off it — that is what made every Back send the destination as its own origin. The server answers
    // `sharedLevels` for a from==to nav (its full layout depth), the client computes `keep` from the route
    // it actually has mounted, and `partialCrossNav` hard-loads on the disagreement.
    setUrl('http://localhost/')
    handlePopState()
    expect(await settleText('Home page')).toContain('Home page')

    const last = fetchCalls[fetchCalls.length - 1]
    if (!last) throw new Error('expected a soft-nav fetch call')
    expect(last.nav).toBe('/about')
    expect(last.url).toContain('/')
})

test('every nav DECLARES what it keeps; a nav that does not know declares nothing', async () => {
    // The full path replaces `#__abide-app` outright, so it keeps nothing and says so. Left to derive,
    // the server answers from the route table alone and can ship a diverging SUFFIX — correct for a
    // graft, and for this path a shell with every layout above it missing.
    await navigate('/about')
    const full = fetchCalls[fetchCalls.length - 1]
    if (!full) throw new Error('expected a soft-nav fetch call')
    expect(full.nav).toBe('/')
    expect(full.keep).toBe('0')

    // A param MOVE keeps its whole chain, so it declares every layout level it HAS — except that this
    // harness registers pages without prefixes, so the client does not know how many that is and
    // declares nothing rather than guess. `0` would be a false claim: it keeps the chain either way,
    // and would buy a full render for nothing.
    await navigate('/users/42')
    await navigate('/users/42?tab=posts')
    const moved = fetchCalls[fetchCalls.length - 1]
    if (!moved) throw new Error('expected a confirm fetch call')
    expect(moved.nav).toBe('/users/42')
    expect(moved.keep).toBeNull()
})

test('a SAME-URL nav asks for the whole tree, so the seed carries the kept layouts’ reads too', async () => {
    await navigate('/users/42')

    // Re-navigating to the URL you are already on is a refresh gesture, and the layouts are on screen.
    // Left alone the server skips every layout level for a same-pattern nav (from == to, so the derived
    // depth is this route's full depth) and renders the page alone — so only the page's reads reach the
    // seed, and a LAYOUT's route-independent read keeps painting its first-paint value exactly as the
    // page's did before any of this. Asking for `0` renders the whole tree.
    await navigate('/users/42')
    const same = fetchCalls[fetchCalls.length - 1]
    if (!same) throw new Error('expected a confirm fetch call')
    expect(same.nav).toBe('/users/42')
    expect(same.keep).toBe('0')
})

test('a superseded param/query nav does not apply its seed', async () => {
    await navigate('/count')
    expect(await settleText('count 1')).toContain('count 1')

    navSeed = { reads: [{ name: 'counter', value: 7 }] }
    const stale = navigate('/count')
    navSeed = { reads: [{ name: 'counter', value: 9 }] }
    await Promise.all([stale, navigate('/count')])

    // Newest-wins: the second nav's seed stands, and the first must not land on top of it afterwards.
    expect(await settleText('count 9')).toContain('count 9')
    for (let i = 0; i < 20; i++) await tick()
    expect(container().textContent).toContain('count 9')
})

test('navigate(url(...)) composes an href from typed params', async () => {
    await navigate(url('/users/[id]', { id: 42 }))

    expect(location.pathname).toBe('/users/42')
    expect(route().params.id).toBe('42')
    expect(container().textContent).toContain('user 42')
})

test('navigate(url(...query)) carries the query into the address and route().url', async () => {
    await navigate(url('/users/[id]', { id: 42 }, { tab: 'posts', page: 2 }))

    expect(location.pathname + location.search).toBe('/users/42?tab=posts&page=2')
    expect(route().params.id).toBe('42')
    // The query survives the soft-nav round-trip into the reactive route.
    expect(route().url.search).toBe('?tab=posts&page=2')
    expect(container().textContent).toContain('user 42')
})

import { routeAmbient } from '../shared/internal/routeAmbient.ts'
import { asSoftNavFrame } from '../shared/internal/softNavFrame.ts'
import { registerPages } from './internal/pageRegistry.ts'
import { documentPatch, documentPatchPreamble } from './internal/streamScheduler.ts'
import { isKnownPage } from './navigate.ts'

test('isKnownPage: only real page patterns are soft-nav targets (not /openapi.json, /rpc/*)', () => {
    const stub = (): (() => void) => () => {}
    registerPages(
        {
            '/': loaderFor({ mount: stub, hydrate: stub }),
            '/machines': loaderFor({ mount: stub, hydrate: stub }),
            '/topics/[slug]': loaderFor({ mount: stub, hydrate: stub }),
        },
        {},
    )
    expect(isKnownPage('/')).toBe(true)
    expect(isKnownPage('/machines')).toBe(true)
    expect(isKnownPage('/topics/hello')).toBe(true)
    expect(isKnownPage('/openapi.json')).toBe(false)
    expect(isKnownPage('/__abide/rpc/greet')).toBe(false)
    expect(isKnownPage('/__abide/mcp')).toBe(false)
    expect(isKnownPage('/nope')).toBe(false)
})

// STREAMED SOFT-NAV PATCH FRAMES (regression: the server emits `fill`/`append`/`complete` frame kinds
// — never `patch` — so the client's frame consumers must apply those exact kinds). `applyPatchFrame`
// mirrors the first-load move-scripts (`documentPatch`) from JS. Before the fix the consumers branched
// on a dead `patch` kind, so `append`/`complete` had NO client implementation at all.
//
// CLASSIFYING a frame is `asSoftNavFrame`'s job now, not this function's — the frame union is the wire
// protocol and lives in `shared/internal/softNavFrame.ts`, so `applyPatchFrame` receives a frame that
// is already known to be a patch and no longer answers "was it one".
test('applyPatchFrame: `fill` replaces the fallback between the {#await} slot sentinels', () => {
    document.body.innerHTML =
        '<div id="host"><!--ab-p:7--><span>loading</span><template id="ab-p:7"></template></div>'
    applyPatchFrame({ kind: 'fill', id: 7, html: '<b data-v>runs: 3</b>' })
    const host = document.getElementById('host')
    expect(host?.querySelector('b[data-v]')?.textContent).toBe('runs: 3')
    expect(host?.querySelector('span')).toBeNull() // the pending fallback was replaced
    // The patch landed BETWEEN the sentinels, both of which survive for hydration to drop.
    expect(document.getElementById('ab-p:7')?.previousSibling?.nodeName).toBe('B')
})

test('applyPatchFrame: `append` inserts items before the list sentinel (#ab-l:<id>)', () => {
    document.body.innerHTML = '<ul id="host"><li>a</li><template id="ab-l:2"></template></ul>'
    applyPatchFrame({ kind: 'append', id: 2, html: '<li>b</li>' })
    applyPatchFrame({ kind: 'append', id: 2, html: '<li>c</li>' })
    expect(document.getElementById('host')?.innerHTML).toBe(
        '<li>a</li><li>b</li><li>c</li><template id="ab-l:2"></template>',
    )
})

// The sentinel is a `<template>`, not a wrapper element, precisely so a streamed `<tr>` is not
// FOSTER-PARENTED out of the table by the HTML parser (a wrapper stranded every patch ABOVE the
// `<table>`, rendering half-formatted rows that hydration then never cleaned up). Built with DOM calls,
// not `innerHTML`: happy-dom foster-parents `<template>` out of a `<tbody>`, which the HTML standard
// forbids (`in table` defers `style`/`script`/`template` to the `in head` rules, inserting in place), so
// only a real browser can attest the PARSE — the Playwright `streaming` e2e covers that end. This
// asserts the DOM op: given the sentinel in a `<tbody>`, the row lands as a real `<tbody>` child.
test('applyPatchFrame: `append` puts a streamed <tr> inside the real <tbody>', () => {
    document.body.innerHTML = '<table><tbody id="host"></tbody></table>'
    const host = document.getElementById('host')
    const sentinel = document.createElement('template')
    sentinel.id = 'ab-l:9'
    host?.appendChild(sentinel)
    applyPatchFrame({ kind: 'append', id: 9, html: '<tr><td>row</td></tr>' })
    expect(host?.querySelector('tr > td')?.textContent).toBe('row')
    expect(host?.querySelector('tr')?.parentElement?.tagName).toBe('TBODY')
})

test('applyPatchFrame: a missing anchor is a safe no-op', () => {
    document.body.innerHTML = ''
    expect(() => applyPatchFrame({ kind: 'fill', id: 99, html: '<b/>' })).not.toThrow()
    expect(() => applyPatchFrame({ kind: 'append', id: 99, html: '<li/>' })).not.toThrow()
})

// The wire protocol's own narrowing, which the three reader loops used to do by hand — each testing
// `typeof frame.html === 'string'` / `typeof frame.sharedLevels === 'number'` and casting the seed.
test('asSoftNavFrame narrows the wire, and declines what it does not know', () => {
    expect(asSoftNavFrame({ kind: 'fill', id: 7, html: '<b/>' })).toEqual({
        kind: 'fill',
        id: 7,
        html: '<b/>',
    })
    // A server predating `sharedLevels` trimmed nothing, which is what `0` means.
    expect(asSoftNavFrame({ kind: 'shell', html: '<p/>', url: '/a' })).toEqual({
        kind: 'shell',
        html: '<p/>',
        url: '/a',
        sharedLevels: 0,
    })
    // There is no `complete` op — it stamped `data-ab-done`, which nothing read. An unrecognised kind
    // (a server NEWER than this bundle) is declined rather than thrown on, so a rolling deploy ignores
    // a frame instead of aborting the nav.
    expect(asSoftNavFrame({ kind: 'complete', id: 99 })).toBeUndefined()
    expect(asSoftNavFrame({ kind: 'fill', id: 'seven', html: '<b/>' })).toBeUndefined()
    expect(asSoftNavFrame(null)).toBeUndefined()
})

// THE FIRST-LOAD HALF OF THE SAME GEOMETRY.
//
// The five cases above cover the soft-nav applier. The first-load move-scripts were a second
// implementation of the identical DOM algorithm — written as a minified JS string, run by the parser,
// and tested by nothing, which is the wrong way round: the soft-nav copy runs only after a nav, the
// string copy runs on every streamed page. Both now call the same `streamPatchDom` ops, so these two
// tests reach the ops THROUGH the emitted script and the cases above cover the default path for free.
//
// Executing the preamble as a `Function` is the honest test of the embedding: it proves the emitted
// text is valid standalone JS (the functions close over nothing) and that the wrappers hand it the
// right sentinel prefixes — the two things stringification could get wrong.
// `window` is passed in rather than read: the test preload deletes the global (so the isomorphic
// modules take their server branch), while the emitted script is browser code and `window` is
// `globalThis` there. Everything else it touches — `document`, the globals the wrappers define — is
// reached exactly as the parser would reach it.
function runDocumentScripts(html: string): void {
    document.body.innerHTML = html
    for (const script of Array.from(document.body.querySelectorAll('script'))) {
        new Function('window', script.textContent ?? '')(globalThis)
    }
}

test('documentPatch: the emitted first-load `fill` script runs the shared DOM op', () => {
    runDocumentScripts(
        `<div id="host"><!--ab-p:7--><span>loading</span><template id="ab-p:7"></template></div>` +
            documentPatchPreamble() +
            documentPatch({ op: 'fill', id: 7, html: '<b data-v>runs: 3</b>' }),
    )
    const host = document.getElementById('host')
    expect(host?.querySelector('b[data-v]')?.textContent).toBe('runs: 3')
    expect(host?.querySelector('span')).toBeNull() // the pending fallback was replaced
    expect(document.getElementById('ab-p:7')?.previousSibling?.nodeName).toBe('B')
    // The carrier `<template>` removes itself, so hydration never sees it.
    expect(document.querySelector('template[data-ab-patch="7"]')).toBeNull()
})

test('documentPatch: the emitted first-load `append` script appends before the list sentinel', () => {
    runDocumentScripts(
        `<ul id="host"><li>a</li><template id="ab-l:2"></template></ul>` +
            documentPatchPreamble() +
            documentPatch({ op: 'append', id: 2, html: '<li>b</li>' }) +
            documentPatch({ op: 'append', id: 2, html: '<li>c</li>' }),
    )
    expect(document.getElementById('host')?.innerHTML).toBe(
        '<li>a</li><li>b</li><li>c</li><template id="ab-l:2"></template>',
    )
})
