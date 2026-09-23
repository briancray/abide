// 30.7 — NAVIGATION THAT DOES NOT RELOAD THE DOCUMENT, end to end. The destination's markup is
// not fetched: a page the reader navigated to is handed the empty anchor pair and fills it from
// the template its own module carries, which is `emitClient`'s `isEmptyRegion` guard doing for a
// PAGE exactly what it already did for an invoked component (32.18).
//
// THE SAME MODULE BOTH WAYS IN is the claim worth holding: the page the server painted hydrates
// where it stands because its region is not empty, and the page navigated to fills because it is.

import { afterAll, expect, test } from 'bun:test'
import { emitClient, emitComponent, parseAbide } from '#compiler'
import { TypeSession } from '#compiler/TypeSession.ts'
import { render } from '#server'
import { composePage } from '#server/render.ts'
import { flushSync, navigate } from '#shared'
import { CURRENT_ROUTER } from '#shared/CURRENT_ROUTER.ts'
import { matchRoute } from '#shared/matchRoute.ts'
import {
    compareRoutes,
    parseRoutePattern,
    routeOf,
} from '#shared/routePattern.ts'
import { applyHead } from '#ui/applyHead.ts'
import { listenForRoutes, type PageMount, startRouter } from '#ui/routing.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const ROOT = new URL('./fixtures/typed/', import.meta.url).pathname
const session = await TypeSession.open(`${ROOT}tsconfig.json`)
afterAll(() => {
    session.close()
    removeTemporaryModules()
    CURRENT_ROUTER.current = null
})

const HOME = `<script>
import { reactive } from 'abide'

let count = reactive(0)
</script>

<main id="home"><h1>Home</h1><p>{count}</p>
<button id="bump" onclick={() => { count = count + 1 }}>+</button>
<a id="to-invoice" href="/invoices/42">invoice 42</a></main>`

const INVOICE = `<script>
import { reactive } from 'abide'

let rows = reactive(['one', 'two'])
</script>

<main id="invoice"><h1>Invoice</h1><ul>{#for row of rows by row}<li>{row}</li>{/for}</ul></main>`

async function pages(): Promise<Record<string, PageMount>> {
    const modules: Record<string, string> = {}
    for (const [name, source] of Object.entries({
        Home: HOME,
        Invoice: INVOICE,
    })) {
        const file = parseAbide(source)
        const reads = await session.reads(`${ROOT}src/${name}.abide`, file)
        modules[`${name}.ts`] = emitComponent(file, reads)
        // ROUTABLE, so the module carries its own markup — what the build now passes for a page.
        modules[`${name}.client.ts`] = emitClient(file, reads, 'once')
    }
    const dir = temporaryModule(modules)
    const home = (await import(`${dir}/Home.client.ts`)).default as PageMount
    const invoice = (await import(`${dir}/Invoice.client.ts`))
        .default as PageMount
    // The server's painting of the HOME page only — the one the reader arrived at.
    const { default: Component } = await import(`${dir}/Home.ts`)
    let html = ''
    for await (const chunk of render(
        Component,
        '<!doctype html><html><head></head><body></body></html>',
    ))
        html += new TextDecoder().decode(chunk)
    document.body.innerHTML = html.slice(
        html.indexOf('<body>') + '<body>'.length,
        html.indexOf('</body>'),
    )
    return { home, invoice }
}

function router(mounts: Record<string, PageMount>) {
    return startRouter([
        {
            pattern: '/invoices/[id]',
            load: async () => ({ default: mounts.invoice as PageMount }),
            layouts: [],
        },
        {
            pattern: '/',
            load: async () => ({ default: mounts.home as PageMount }),
            layouts: [],
        },
    ])
}

test('a page the server painted hydrates, and the one navigated to builds itself — 30.7', async () => {
    history.replaceState(null, '', '/')
    const mounts = await pages()
    const r = router(mounts)

    // ARRIVED AT: the markup is the server's and the region is not empty, so nothing is filled.
    await r.hydrate()
    flushSync()
    expect(document.querySelector('#home h1')?.textContent).toBe('Home')
    ;(document.querySelector('#bump') as HTMLElement).click()
    flushSync()
    expect(document.querySelector('#home p')?.textContent).toBe('1')

    // NAVIGATED TO: no server, no fetch. The module fills the region it was handed.
    await navigate('/invoices/42')
    flushSync()
    expect(location.pathname).toBe('/invoices/42')
    expect(document.querySelector('#home')).toBeNull()
    expect(document.querySelector('#invoice h1')?.textContent).toBe('Invoice')
    expect(
        [...document.querySelectorAll('#invoice li')].map((n) => n.textContent),
    ).toEqual(['one', 'two'])
})

// 12.13 through the router: the page it replaced owned a scope, and the router is the only thing
// that can remove its nodes. THE REVERT: drop the `this.stopFrom(shared)` call from `Router.go` —
// the old page's binding goes on waking for every write into nodes no longer in the document.
test('the page a navigation replaced stops its bindings — 12.13', async () => {
    history.replaceState(null, '', '/')
    const mounts = await pages()
    const r = router(mounts)
    await r.hydrate()
    flushSync()
    const scope = r.scope
    expect(scope?.stops.length).toBeGreaterThan(0)

    await navigate('/invoices/42')
    flushSync()
    expect(scope?.stops.length).toBe(0)
})

test('a click on a routed link navigates and does not reload — 30.7', async () => {
    history.replaceState(null, '', '/')
    const mounts = await pages()
    const r = router(mounts)
    await r.hydrate()
    flushSync()
    const stop = listenForRoutes(r)

    const link = document.querySelector('#to-invoice') as HTMLElement
    const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
    })
    link.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    // A CLICK IS FIRE AND FORGET: `listenForRoutes` calls `go` and keeps no promise, so the wait
    // has to drain whatever the navigation queued rather than count turns. Two `Promise.resolve`
    // was that count, and it went stale the moment the chain gained a level to load (35.1).
    await Bun.sleep(0)
    flushSync()
    expect(document.querySelector('#invoice h1')?.textContent).toBe('Invoice')
    stop()
})

// 30.14 — INTENT LOADS THE CODE AND NOTHING ELSE. A pointer over a routed link asks for the route's
// chunk, and the address and the page stay where they were. THE REVERT: drop the `pointerover`
// listener in `listenForRoutes`; the chunk is loaded 0 times where 1 is due, and the click pays it.
test("a pointer over a routed link loads the route's chunk, and does not navigate — 30.14", async () => {
    history.replaceState(null, '', '/')
    const mounts = await pages()
    let loads = 0
    const r = startRouter([
        {
            pattern: '/invoices/[id]',
            load: async () => {
                loads += 1
                return { default: mounts.invoice as PageMount }
            },
            layouts: [],
        },
        {
            pattern: '/',
            load: async () => ({ default: mounts.home as PageMount }),
            layouts: [],
        },
    ])
    await r.hydrate()
    flushSync()
    const stop = listenForRoutes(r)
    const link = document.querySelector('#to-invoice') as HTMLElement
    link.dispatchEvent(new Event('pointerover', { bubbles: true }))
    await Bun.sleep(0)
    expect(loads).toBe(1)
    expect(location.pathname).toBe('/')
    expect(document.querySelector('#home h1')?.textContent).toBe('Home')
    stop()
})

test('a route literal is matched in the spelling its directory is filed under — 30.3, 30.5', () => {
    expect(routeOf('src/ui/pages/invoices/[id]/page.abide')).toBe(
        '/invoices/[id]',
    )
    expect(routeOf('src/ui/pages/page.abide')).toBe('/')
    expect(
        matchRoute(parseRoutePattern('/invoices/[id]'), '/invoices/42'),
    ).toEqual({ id: '42' })
    expect(
        matchRoute(parseRoutePattern('/invoices/[id]'), '/invoices'),
    ).toBeNull()
    expect(
        matchRoute(parseRoutePattern('/files/[...rest]'), '/files/a/b'),
    ).toEqual({ rest: ['a', 'b'] })
    expect(matchRoute(parseRoutePattern('/x/[[y]]'), '/x')).toEqual({})
})

// 30.9 — THE MOST SPECIFIC ROUTE WINS, and every case here is one where TWO patterns match the
// same path, which is the only situation the order decides anything in. A table matched in the
// wrong order renders the wrong page and says nothing, so nothing about the output can catch it.
//
// THE REVERT: the scalar this replaced — `segments.length * 10` plus 4/3/2 a kind, sorted
// descending. `/x` scores 14 against `/[[a]]/[[b]]`'s 24, so the first pair comes out reversed;
// `/[id]/edit` and `/new/[tab]` both score 27, so the third pair is decided by whichever the
// build walked first. A sum over the whole pattern can carry neither the ordering nor the
// position, and those are the two things 30.9 is.
test('the most specific of two matching routes is tried first — 30.9', () => {
    const order = (patterns: string[]): string[] =>
        [...patterns]
            .map((pattern) => ({
                pattern,
                segments: parseRoutePattern(pattern),
            }))
            .sort((a, b) => compareRoutes(a.segments, b.segments))
            .map((route) => route.pattern)

    // A STATIC SEGMENT ABOVE AN OPTIONAL, and length must not overturn it: both match `/x`.
    expect(order(['/[[a]]/[[b]]', '/x'])).toEqual(['/x', '/[[a]]/[[b]]'])
    // The three kind steps the clause names, each against the one below it.
    expect(order(['/[id]', '/new'])).toEqual(['/new', '/[id]'])
    expect(order(['/[[id]]', '/[id]'])).toEqual(['/[id]', '/[[id]]'])
    expect(order(['/[...rest]', '/[[id]]'])).toEqual(['/[[id]]', '/[...rest]'])
    // POSITION, which a sum erases: both match `/new/edit`, and the FIRST segment decides.
    expect(order(['/[id]/edit', '/new/[tab]'])).toEqual([
        '/new/[tab]',
        '/[id]/edit',
    ])
    // An exhausted prefix is the only tie left, and the shorter pattern is the narrower claim:
    // `/a` admits one address where `/a/[[b]]` admits two, and both answer `/a`.
    expect(order(['/a/[[b]]', '/a'])).toEqual(['/a', '/a/[[b]]'])
})

// 39.6 — THE INCOMING PAGE'S KEYED CONTRIBUTIONS REPLACE THE OUTGOING PAGE'S, BY KEY. The head a
// navigation arrives with was never rendered by a server, so it comes from the page's own module
// (39.11 gives the key, 39.12 the winner within a file).
//
// THE REVERT: append every contribution instead of replacing the one under its key — the document
// ends with two `<title>`s and the browser keeps showing the first.
test('a navigation replaces head contributions by key and appends the keyless — 39.6', () => {
    document.head.innerHTML =
        '<title>Home</title><meta name="description" content="home"><meta property="og:title" content="Home"><link rel="icon" href="/a.ico">'

    applyHead(
        '<title>Invoice</title><meta name="description" content="an invoice"><meta charset="utf-8"><link rel="icon" href="/a.ico">',
    )

    const titles = document.head.querySelectorAll('title')
    expect(titles).toHaveLength(1)
    expect(titles[0]?.textContent).toBe('Invoice')

    const description = document.head.querySelectorAll(
        'meta[name="description"]',
    )
    expect(description).toHaveLength(1)
    expect(description[0]?.getAttribute('content')).toBe('an invoice')

    // 39.11 — `property` keys a `<meta>` too, and the outgoing page's is left alone where the
    // incoming page makes no contribution under that key.
    expect(
        document.head.querySelectorAll('meta[property="og:title"]'),
    ).toHaveLength(1)

    // Same `rel` AND same `href` is one key, so the icon is replaced rather than doubled.
    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1)

    // 39.5 — a `<meta charset>` has no key, so it appends rather than replacing anything.
    expect(document.head.querySelectorAll('meta[charset]')).toHaveLength(1)
})

// The head a page carries is emitted into its own module, merged by 39.12 before it gets there —
// so the LAST `<title>` in the file is the only one the client can ever apply.
test("a routable page's client module carries its merged head — 39.12", async () => {
    const file = parseAbide(
        `<head><title>First</title><meta name="a" content="1"></head>
<head><title>Second</title></head>
<p>body</p>`,
    )
    const reads = await session.reads(`${ROOT}src/Head.abide`, file)
    const client = emitClient(file, reads, 'once')
    expect(client).toContain('export function head()')
    expect(client).toContain('Second')
    expect(client).not.toContain('First')
    // A page nobody navigates to needs none of it.
    expect(emitClient(file, reads, 'none')).not.toContain(
        'export function head()',
    )
})

// A NAVIGATION THAT WAS SUPERSEDED MUST NOT MOUNT ON TOP OF THE ONE THAT REPLACED IT. Both ways
// into a page await the destination's module before they touch anything, and a dynamic import
// resolves when its chunk arrives rather than in the order it was asked for — so two clicks, or a
// click landing while `hydrate` is still loading, each reached the mount. The second to FINISH
// overwrote `router.scope`, and the first page's bindings were left awake over nodes the other
// page had replaced: 12.13's leak, arriving through the one caller that is not a region.
//
// NOTHING ON SCREEN SHOWED IT, which is why this is a ticket rather than a flag — the newest
// markup was on top either way, and only the address bar and the scope nobody stopped were wrong.
//
// THE LOADS RESOLVE OUT OF ORDER ON PURPOSE. Resolved in call order the bug does not reproduce at
// all: the later navigation lands last and wins by accident, which is what made this look fine
// for as long as every route's chunk was already cached.
//
// THE REVERT: drop the `this.navigation !== ticket` check from `Router.go`. The invoice page
// mounts over the home page that replaced it, and this reports `/invoices/42` where `/` is due.
test('a superseded navigation does not mount over the one that replaced it', async () => {
    history.replaceState(null, '', '/')
    const mounts = await pages()

    let landInvoice = (): void => {}
    const r = startRouter([
        {
            pattern: '/invoices/[id]',
            load: () =>
                new Promise((resolve) => {
                    landInvoice = () =>
                        resolve({ default: mounts.invoice as PageMount })
                }),
            layouts: [],
        },
        {
            pattern: '/',
            load: async () => ({ default: mounts.home as PageMount }),
            layouts: [],
        },
    ])
    await r.hydrate()
    flushSync()

    const superseded = r.go('/invoices/42')
    const winner = r.go('/')
    await winner
    flushSync()
    const settled = r.scope

    landInvoice()
    await superseded
    flushSync()

    expect(location.pathname).toBe('/')
    expect(document.querySelector('#invoice')).toBeNull()
    expect(document.querySelector('#home h1')?.textContent).toBe('Home')
    // AND THE WINNER'S SCOPE IS STILL THE ROUTER'S — the superseded mount never replaced it, so
    // there is no page left awake with nothing able to stop it.
    expect(r.scope).toBe(settled)
})

// 35.1 AND 41.11 ON THE CLIENT. A layout is mounted once and the page under it is what a
// navigation replaces — which is the whole reason to put chrome in a layout rather than in each
// page, and the one part of it a string assertion cannot see: the header keeps its scroll, an
// open menu stays open, and a component mid-load is still mid-load.
const CHROME = `<script>
import { reactive } from 'abide'

let opened = reactive(0)
</script>

<div id="chrome"><button id="open" onclick={() => { opened = opened + 1 }}>menu {opened}</button><slot/></div>`

const SETTINGS = `<main id="settings"><h1>Settings</h1></main>`

// The same three files the build would have compiled, as modules a table can name.
async function chained(): Promise<{
    layout: PageMount
    home: PageMount
    invoice: PageMount
    settings: PageMount
    painted: string
}> {
    const modules: Record<string, string> = {}
    for (const [name, source] of Object.entries({
        Chrome: CHROME,
        Home: HOME,
        Invoice: INVOICE,
        Settings: SETTINGS,
    })) {
        const file = parseAbide(source)
        const reads = await session.reads(`${ROOT}src/${name}.abide`, file)
        modules[`${name}.ts`] = emitComponent(file, reads)
        modules[`${name}.client.ts`] = emitClient(file, reads, 'once')
    }
    const dir = temporaryModule(modules)
    const mount = async (name: string): Promise<PageMount> =>
        (await import(`${dir}/${name}.client.ts`)).default as PageMount

    // The document the SERVER painted for `/`: the page inside its layout, composed the one way
    // `answerRequest` composes it.
    const Layout = (await import(`${dir}/Chrome.ts`)).default
    const Home = (await import(`${dir}/Home.ts`)).default
    let html = ''
    for await (const chunk of render(
        () => composePage([Layout], Home, { params: () => ({}) }),
        '<!doctype html><html><head></head><body></body></html>',
    ))
        html += new TextDecoder().decode(chunk)

    return {
        layout: await mount('Chrome'),
        home: await mount('Home'),
        invoice: await mount('Invoice'),
        settings: await mount('Settings'),
        painted: html,
    }
}

test('a page hydrates inside the layout the server painted — 35.1', async () => {
    history.replaceState(null, '', '/')
    const parts = await chained()
    document.body.innerHTML = parts.painted.slice(
        parts.painted.indexOf('<body>') + '<body>'.length,
        parts.painted.indexOf('</body>'),
    )
    const wrapping = async (): Promise<{ default: PageMount }> => ({
        default: parts.layout,
    })
    const r = startRouter([
        {
            pattern: '/invoices/[id]',
            load: async () => ({ default: parts.invoice }),
            layouts: [wrapping],
        },
        {
            pattern: '/settings',
            load: async () => ({ default: parts.settings }),
            layouts: [],
        },
        {
            pattern: '/',
            load: async () => ({ default: parts.home }),
            layouts: [wrapping],
        },
    ])
    await r.hydrate()
    flushSync()

    // The layout's markup is the server's, and the page stands inside it rather than beside it.
    const chrome = document.querySelector('#chrome') as HTMLElement
    expect(chrome.querySelector('#home h1')?.textContent).toBe('Home')
    // AND BOTH ARE ALIVE: the layout's own binding and the page's, which is the pair a
    // composition that rendered but never mounted would fail.
    ;(document.querySelector('#open') as HTMLElement).click()
    flushSync()
    expect(document.querySelector('#open')?.textContent).toBe('menu 1')
    ;(document.querySelector('#bump') as HTMLElement).click()
    flushSync()
    expect(document.querySelector('#home p')?.textContent).toBe('1')

    // 41.11 — THE SAME NODE AFTER A NAVIGATION, not an identical one. A marker on the element
    // is the only way to tell a kept layout from a rebuilt one that looks the same.
    ;(chrome as unknown as { __KEPT__?: string }).__KEPT__ = 'yes'
    await navigate('/invoices/42')
    flushSync()
    expect(document.querySelector('#invoice h1')?.textContent).toBe('Invoice')
    const after = document.querySelector('#chrome') as HTMLElement
    expect((after as unknown as { __KEPT__?: string }).__KEPT__).toBe('yes')
    // The layout's own state survived with its nodes, which is what the clause is FOR.
    expect(document.querySelector('#open')?.textContent).toBe('menu 1')
    // And the page it was holding is gone rather than left under the new one.
    expect(document.querySelector('#home')).toBeNull()

    // A PAGE UNDER NO LAYOUT REPLACES IT. The chain is part of the address, so leaving the
    // section leaves its chrome.
    await navigate('/settings')
    flushSync()
    expect(document.querySelector('#settings h1')?.textContent).toBe('Settings')
    expect(document.querySelector('#chrome')).toBeNull()
})
