// 30.7 — NAVIGATION THAT DOES NOT RELOAD THE DOCUMENT, end to end. The destination's markup is
// not fetched — the server is asked only whether the navigation may happen (30.15): a page the reader navigated to is handed the empty anchor pair and fills it from
// the template its own module carries, which is `emitClient`'s `fillEmpty` doing for a
// PAGE exactly what it already did for an invoked component (32.17).
//
// THE SAME MODULE BOTH WAYS IN is the claim worth holding: the page the server painted hydrates
// where it stands because its region is not empty, and the page navigated to fills because it is.

import { afterAll, afterEach, expect, test } from 'bun:test'
import { emitClient, emitComponent, parseAbide } from '#compiler'
import { TypeSession } from '#compiler/TypeSession.ts'
import { routeOf } from '#server/placement.ts'
import { composePage, renderDocument } from '#server/render.ts'
import { flushSync, navigate, route } from '#shared'
import { REGION_CLOSE, REGION_OPEN } from '#shared/ANCHORS.ts'
import { CURRENT_ROUTER } from '#shared/CURRENT_ROUTER.ts'
import {
    coversPrefix,
    firstMatch,
    type Params,
    partsOf,
} from '#shared/matchRoute.ts'
import {
    compareRoutes,
    parseRoutePattern,
    type Segment,
} from '#shared/routePattern.ts'
import { applyHead } from '#ui/applyHead.ts'
import { listenForRoutes, type PageMount, startRouter } from '#ui/routing.ts'
import { servedModules } from './servedModules.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const ROOT = new URL('./fixtures/typed/', import.meta.url).pathname
const session = await TypeSession.open(`${ROOT}tsconfig.json`)
// 30.15 — THE SERVER EVERY NAVIGATION ASKS FIRST: a go-ahead unless a test says otherwise, and
// the addresses asked, in order.
const asked: string[] = []
// 30.31 — the signal each of those requests was sent with, in the same order.
const signals: (AbortSignal | undefined)[] = []
const goAhead = (): Response => new Response(null, { status: 204 })
let answering: (url: URL) => Response = goAhead
const unstubbed = globalThis.fetch
globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input))
    asked.push(url.pathname)
    signals.push(init?.signal ?? undefined)
    const answer = answering(url)
    // A fetched answer carries the address it came from, and one built by hand carries ''.
    return answer.url === ''
        ? Object.defineProperty(answer, 'url', { value: url.href })
        : answer
}) as typeof fetch
afterEach(() => {
    answering = goAhead
    asked.length = 0
    signals.length = 0
})
afterAll(async () => {
    await session.close()
    removeTemporaryModules()
    CURRENT_ROUTER.current = null
    globalThis.fetch = unstubbed
})

const HOME = `<script>
import { reactive } from '@abide/abide'

let count = reactive(0)
</script>

<main id="home"><h1>Home</h1><p>{count}</p>
<button id="bump" onclick={() => { count = count + 1 }}>+</button>
<a id="to-invoice" href="/invoices/42">invoice 42</a></main>`

const INVOICE = `<script>
import { reactive } from '@abide/abide'

let rows = reactive(['one', 'two'])
</script>

<main id="invoice"><h1>Invoice</h1><ul>{#for row of rows by row}<li>{row}</li>{/for}</ul></main>`

async function pages(
    shell = '<!doctype html><html><head></head><body></body></html>',
    homeSource = HOME,
): Promise<Record<string, PageMount>> {
    const modules: Record<string, string> = {}
    for (const [name, source] of Object.entries({
        Home: homeSource,
        Invoice: INVOICE,
    })) {
        const file = parseAbide(source)
        const reads = await session.reads(`${ROOT}src/${name}.abide`, file)
        modules[`${name}.ts`] = emitComponent(file, reads)
        // ROUTABLE, so the module carries its own markup — what the build now passes for a page.
        modules[`${name}.client.ts`] = emitClient(file, reads, 'routed')
    }
    const dir = temporaryModule(modules)
    const home = (await import(`${dir}/Home.client.ts`)).default as PageMount
    const invoice = (await import(`${dir}/Invoice.client.ts`))
        .default as PageMount
    // The server's painting of the HOME page only — the one the reader arrived at.
    const { default: Component } = await import(`${dir}/Home.ts`)
    let html = ''
    html += new TextDecoder().decode(await renderDocument(Component, shell))
    document.body.innerHTML = html.slice(
        html.indexOf('<body>') + '<body>'.length,
        html.indexOf('</body>'),
    )
    return { home, invoice }
}

function router(mounts: Record<string, PageMount>, transitions = false) {
    return startRouter(
        [
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
        ],
        document.body,
        transitions,
    )
}

function matchRoute(segments: Segment[], pathname: string): Params | null {
    const parts = partsOf(pathname)
    if (parts === undefined) return null
    return firstMatch([{ segments }], parts)?.params ?? null
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

    // NAVIGATED TO: the server is asked, and the module fills the region it was handed.
    await navigate('/invoices/42')
    flushSync()
    expect(location.pathname).toBe('/invoices/42')
    expect(document.querySelector('#home')).toBeNull()
    expect(document.querySelector('#invoice h1')?.textContent).toBe('Invoice')
    expect(
        [...document.querySelectorAll('#invoice li')].map((n) => n.textContent),
    ).toEqual(['one', 'two'])
})

// 30.17 — A REDIRECT THE SERVER'S MIDDLEWARE WROTE IS WHERE THE NAVIGATION LANDS, mounted and
// written to the address bar in place of the address asked for. THE REVERT: commit `target` whether
// or not the answer was redirected; the bar reads /invoices/42 and the page its params.
test('a navigation lands where the server redirected it — 30.15, 30.17', async () => {
    history.replaceState(null, '', '/')
    const r = router(await pages())
    await r.hydrate()
    answering = (url) =>
        Object.defineProperties(goAhead(), {
            redirected: { value: url.pathname === '/invoices/42' },
            url: { value: new URL('/invoices/7', url).href },
        })
    await navigate('/invoices/42')
    flushSync()
    expect(asked).toEqual(['/invoices/42'])
    expect(location.pathname).toBe('/invoices/7')
    expect(route.params()).toEqual({ id: '7' })
    expect(document.querySelector('#invoice h1')?.textContent).toBe('Invoice')
})

// 30.18 — ANYTHING BUT A GO-AHEAD IS THE DOCUMENT'S: the router mounts nothing and writes no history
// entry. THE REVERT: drop the status check in `Router.go`; the invoice mounts under a refusal.
test('a navigation the server refuses is left to the document — 30.18', async () => {
    history.replaceState(null, '', '/')
    const r = router(await pages())
    await r.hydrate()
    const entries = history.length
    let left = ''
    answering = () => new Response('refused', { status: 403 })
    const assign = Object.getOwnPropertyDescriptor(location, 'href')
    Object.defineProperty(location, 'href', {
        configurable: true,
        get: () => 'http://localhost/',
        set: (to: string) => {
            left = to
        },
    })
    try {
        await navigate('/invoices/42')
    } finally {
        if (assign !== undefined)
            Object.defineProperty(location, 'href', assign)
        else delete (location as { href?: string }).href
    }
    flushSync()
    expect(left).toEndWith('/invoices/42')
    expect(history.length).toBe(entries)
    expect(document.querySelector('#invoice')).toBeNull()
    expect(document.querySelector('#home h1')?.textContent).toBe('Home')
})

// 30.27 — A SERVER THAT CANNOT BE REACHED: the request throws and so does the page's chunk. THE
// REVERT: call `load` in place of `loadOrMiss` in `Router.go`; the rejection escapes a click's
// `void`, the address is never handed over and `left` stays ''.
test('a navigation whose chunks fail to load is left to the document — 30.27', async () => {
    history.replaceState(null, '', '/')
    const mounts = await pages()
    const r = startRouter(
        [
            {
                pattern: '/invoices/[id]',
                load: () => Promise.reject(new TypeError('Failed to fetch')),
                layouts: [],
            },
            {
                pattern: '/',
                load: async () => ({ default: mounts.home as PageMount }),
                layouts: [],
            },
        ],
        document.body,
        false,
    )
    await r.hydrate()
    const entries = history.length
    let left = ''
    answering = () => {
        throw new TypeError('Failed to fetch')
    }
    const assign = Object.getOwnPropertyDescriptor(location, 'href')
    Object.defineProperty(location, 'href', {
        configurable: true,
        get: () => 'http://localhost/',
        set: (to: string) => {
            left = to
        },
    })
    try {
        await navigate('/invoices/42')
    } catch {
        // the revert's rejection; `left` reports it
    } finally {
        if (assign !== undefined)
            Object.defineProperty(location, 'href', assign)
        else delete (location as { href?: string }).href
    }
    flushSync()
    expect(left).toEndWith('/invoices/42')
    expect(history.length).toBe(entries)
    expect(route.navigating()).toBe(false)
    expect(document.querySelector('#home h1')?.textContent).toBe('Home')
})

// 23.1, 23.2, 23.6 — THE ROUTER FILLS `route`: at hydration from the address the server painted, and
// on a navigation BEFORE the arriving page mounts, with `navigating` true for as long as its chunk
// is loading. THE REVERT: move `arrive` after `mountFrom` in `Router.go`; the page's setup reads
// the params of the address it left, and this reports `{}` where `{ id: '7' }` is due.
test('the router fills route on hydration and on a navigation — 23.1, 23.2', async () => {
    history.replaceState(null, '', '/')
    const mounts = await pages()
    let release = (): void => {}
    let seen: unknown
    const r = startRouter([
        {
            pattern: '/invoices/[id]',
            load: () =>
                new Promise((done) => {
                    release = () =>
                        done({
                            default: ((region, props) => {
                                seen = route.params()
                                return (mounts.invoice as PageMount)(
                                    region,
                                    props,
                                )
                            }) as PageMount,
                        })
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
    expect(route.name()).toBe('/')
    expect(route.url().pathname).toBe('/')
    expect(route.navigating()).toBe(false)
    const before = route.url()

    const going = navigate('/invoices/7?tab=lines')
    await Promise.resolve()
    expect(route.navigating()).toBe(true)
    release()
    await going
    expect(route.navigating()).toBe(false)
    expect(seen).toEqual({ id: '7' })
    expect(route.name()).toBe('/invoices/[id]')
    expect(route.url().search).toBe('?tab=lines')
    expect(route.url()).not.toBe(before)
})

// 23.2 — A NAVIGATION THAT THROWS IS STILL OVER. THE REVERT: clear `navigating` only on the paths
// that complete, as `Router.go` did; a page whose setup throws then leaves it true for good, and
// every "loading…" bound to it stays up over a page that never arrived.
test('a page whose setup throws still ends the navigation — 23.2', async () => {
    history.replaceState(null, '', '/')
    const mounts = await pages()
    const r = startRouter([
        {
            pattern: '/invoices/[id]',
            load: async () => ({
                default: (() => {
                    throw new Error('setup failed')
                }) as PageMount,
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
    let thrown: unknown
    try {
        await navigate('/invoices/7')
    } catch (error) {
        thrown = error
    }
    expect((thrown as Error | undefined)?.message).toBe('setup failed')
    expect(route.navigating()).toBe(false)
})

// 15.16, 30.10 — AN ADDRESS THAT WILL NOT PERCENT-DECODE IS NO ROUTE, and the router leaves it to
// the document rather than throwing. THE REVERT: let `partsOf` throw the `URIError`; this `match`
// then throws, and so does every hover, focus and click on a link to such an address.
test('an address that will not percent-decode matches nothing — 15.16, 30.10', async () => {
    history.replaceState(null, '', '/')
    const r = router(await pages())
    expect(r.match('/%E0%A4%A')).toBeUndefined()
    expect(r.match('/invoices/%E0%A4%A')).toBeUndefined()
    expect(r.match('/invoices/42')?.params).toEqual({ id: '42' })
})

// 41.9 — THE PAGE IS THE PAIR THE SERVER WROTE, and what a shell puts in the body beside it is not
// the page. THE REVERT: write `rendered.body` bare in `render` and have `startRouter` put a pair
// round the host's first child and its last non-script one, as it did; the walk then starts at the
// shell's `<header>`, so the page hydrates dead (`#home p` stays 0 where 1 is due), and the first
// navigation removes the header and the script with the page.
test("a shell's own body markup stays outside the page region — 41.9", async () => {
    history.replaceState(null, '', '/')
    const mounts = await pages(
        '<!doctype html><html><head></head><body><header id="shell">chrome</header><script id="entry"></script></body></html>',
    )
    const r = router(mounts)
    await r.hydrate()
    flushSync()
    ;(document.querySelector('#bump') as HTMLElement).click()
    flushSync()
    expect(document.querySelector('#home p')?.textContent).toBe('1')

    await navigate('/invoices/42')
    flushSync()
    expect(document.querySelector('#invoice h1')?.textContent).toBe('Invoice')
    expect(document.querySelector('#shell')?.textContent).toBe('chrome')
    expect(document.querySelector('#entry')).not.toBeNull()
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
    const scope = r.levels.at(-1)?.scope
    expect(scope?.stops.length).toBeGreaterThan(0)

    await navigate('/invoices/42')
    flushSync()
    expect(scope?.stops.length).toBe(0)
})

// 12.4 — A WATCH THE PAGE'S SETUP OPENED IS THE PAGE'S, and stops with it. The setup runs before
// the markup that makes the page's scope — a routed level's markup later still (41.19) — so the
// watch's disposer is collected and handed over. Left where nothing held it, the watch went on
// waking at every navigation for the rest of the session, writing whatever it wrote over the page
// that replaced it. COUNTED PER INSTANCE: the server's render ran this setup too, in this process.
// THE REVERT: drop `owned` from `watch` — the navigation leaves the browser's watch run twice and
// disposed once, still alive.
test("a watch the page's setup opened stops when a navigation replaces the page — 12.4", async () => {
    history.replaceState(null, '', '/')
    const mounts = await pages(
        undefined,
        `<script>
import { route, watch } from '@abide/abide'

const instances = ((globalThis as { instances?: { runs: number; disposed: number }[] }).instances ??= [])
const counts = { runs: 0, disposed: 0 }
instances.push(counts)
watch(() => {
    route.params()
    counts.runs += 1
    return () => {
        counts.disposed += 1
    }
})
</script>

<main id="home"><h1>Home</h1></main>`,
    )
    const r = router(mounts)
    await r.hydrate()
    flushSync()
    const counts = (
        globalThis as { instances?: { runs: number; disposed: number }[] }
    ).instances?.at(-1) as { runs: number; disposed: number }
    expect(counts.runs).toBeGreaterThan(0)

    await navigate('/invoices/42')
    flushSync()
    const settled = counts.runs
    expect(counts.disposed).toBe(settled)

    await navigate('/invoices/7')
    flushSync()
    expect(counts).toEqual({ runs: settled, disposed: settled })
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

// 30.13 — A PLAIN CLICK IS THE APP'S, AND ANY OTHER IS THE BROWSER'S: a modifier, a `target` or a
// `download` asks for a tab, a window or a file, and a router that took one navigated in place
// instead. THE REVERT: have `isPlainClick` answer true and `sameOriginLink` skip its `download` and
// `target` tests — all seven are taken, `defaultPrevented` true where false is due.
test('a modified click, a target or a download is left to the browser — 30.13', async () => {
    history.replaceState(null, '', '/')
    const r = router(await pages())
    await r.hydrate()
    flushSync()
    const stop = listenForRoutes(r)
    const link = document.querySelector('#to-invoice') as HTMLAnchorElement
    const taken = (init: MouseEventInit): boolean => {
        const event = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            button: 0,
            ...init,
        })
        link.dispatchEvent(event)
        return event.defaultPrevented
    }
    const refused: Record<string, boolean> = {}
    for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const)
        refused[key] = taken({ [key]: true })
    refused.middle = taken({ button: 1 })
    link.setAttribute('target', '_blank')
    refused.target = taken({})
    link.removeAttribute('target')
    link.setAttribute('download', '')
    refused.download = taken({})
    link.removeAttribute('download')
    stop()
    expect(refused).toEqual({
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        middle: false,
        target: false,
        download: false,
    })
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

test('a route literal is matched in the spelling its directory is filed under — 30.3, 30.5, 23.14', () => {
    expect(routeOf('invoices/[id]/index.abide')).toBe('/invoices/[id]')
    expect(routeOf('index.abide')).toBe('/')
    // 23.14 — a file's route is its path without its extension, and an `index`, a `layout` and an
    // `error` take their directory's. THE REVERT: push every stem in `routeOf`; the first reports
    // `/invoices/[id]/index`.
    expect(routeOf('media/[id].abide')).toBe('/media/[id]')
    expect(routeOf('media/[id]/comments.abide')).toBe('/media/[id]/comments')
    expect(routeOf('media/getGrid.ts')).toBe('/media/getGrid')
    // Only the three `.abide` names are their directory's: a handler file is its own name.
    expect(routeOf('media/index.ts')).toBe('/media/index')
    expect(routeOf('admin/media/layout.abide')).toBe('/admin/media')
    expect(routeOf('admin/media/error.abide')).toBe('/admin/media')
    // A section named `pages` keeps its name.
    expect(routeOf('pages/add-a-page/index.abide')).toBe('/pages/add-a-page')
    expect(routeOf('pages/index.abide')).toBe('/pages')
    expect(
        matchRoute(parseRoutePattern('/invoices/[id]'), '/invoices/42'),
    ).toEqual({ id: '42' })
    expect(
        matchRoute(parseRoutePattern('/invoices/[id]'), '/invoices'),
    ).toBeNull()
    expect(
        matchRoute(parseRoutePattern('/files/[...rest]'), '/files/a/b'),
    ).toEqual({ rest: ['a', 'b'] })
    // 16.69 — a rest leaves the segments after it what they need.
    expect(
        matchRoute(
            parseRoutePattern('/files/[...rest]/save'),
            '/files/a/b/save',
        ),
    ).toEqual({ rest: ['a', 'b'] })
    expect(
        matchRoute(parseRoutePattern('/files/[...rest]/save'), '/files/save'),
    ).toEqual({ rest: [] })
    expect(
        matchRoute(parseRoutePattern('/files/[...rest]/save'), '/files/a/b'),
    ).toBeNull()
    expect(matchRoute(parseRoutePattern('/x/[[y]]'), '/x')).toEqual({})
})

// 30.4 — AN OPTIONAL LEFT OUT OMITS ITS SEGMENT WHEREVER IT STANDS, not only at the end. THE REVERT:
// take an optional's part greedily and never retry without it; `/[[lang]]/docs` then spends `docs`
// on `lang` and misses `/docs`, and an error page under it stops covering the addresses below.
test('an optional in the middle may be left out — 30.4, 35.2', () => {
    const docs = parseRoutePattern('/[[lang]]/docs')
    expect(matchRoute(docs, '/docs')).toEqual({})
    expect(matchRoute(docs, '/en/docs')).toEqual({ lang: 'en' })
    expect(matchRoute(docs, '/en/other')).toBeNull()
    expect(coversPrefix(docs, ['docs', 'intro'])).toBe(true)
    expect(coversPrefix(docs, ['en', 'docs', 'intro'])).toBe(true)
    expect(coversPrefix(docs, ['blog'])).toBe(false)
    // A rest takes nothing as readily as something, so its directory covers its own address.
    expect(coversPrefix(parseRoutePattern('/files/[...path]'), ['files'])).toBe(
        true,
    )
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
    // UNLESS THE PREFIX LEAVES AN OPTIONAL OUT: both match `/about`, the shorter by taking `about`
    // as `lang` and the longer by a static segment, which is the narrower claim. THE REVERT: the
    // shorter always wins a tie; `/[[lang]]/about` — and a handler in the `[[lang]]` directory —
    // ranks second and `/about` paints the `[[lang]]` page.
    expect(order(['/[[lang]]', '/[[lang]]/about'])).toEqual([
        '/[[lang]]/about',
        '/[[lang]]',
    ])
    expect(order(['/[[a]]', '/[[a]]/[b]'])).toEqual(['/[[a]]/[b]', '/[[a]]'])
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
    const client = emitClient(file, reads, 'routed')
    expect(client).toContain('__applyHead(')
    expect(client).toContain('Second')
    expect(client).not.toContain('First')
    // A page nobody navigates to needs none of it.
    expect(emitClient(file, reads, 'none')).not.toContain('__applyHead(')
})

// 39.6 — A HEAD READS THE INSTANCE, as a body slot does. `<title>{title}</title>` over a setup
// `const` is the ordinary way to title a page, and the head is applied from inside the mount that
// declared it — emitted at module scope it read a name only `mount` had, and a navigation to the
// page threw after the old page was already gone.
//
// THE REVERT: emit the head as a module-scope `export function head()` and apply it from the
// router's commit. The navigation then rejects with `ReferenceError: title is not defined` where
// it is due to resolve and title the document `Arrived`.
test("a navigated page's head reads the names its setup declared — 39.6", async () => {
    history.replaceState(null, '', '/')
    document.head.innerHTML = '<title>Home</title>'
    const mounts = await pages()
    const source = `<head><title>{title}</title></head>
<script>
const title = 'Arrived'
</script>
<main id="titled"><h1>{title}</h1></main>`
    const file = parseAbide(source)
    const reads = await session.reads(`${ROOT}src/Titled.abide`, file)
    const dir = temporaryModule({
        'Titled.client.ts': emitClient(file, reads, 'routed'),
    })
    const r = startRouter(
        [
            {
                pattern: '/titled',
                // THE WHOLE MODULE, as the emitted route table loads it — not its default alone.
                load: () => import(`${dir}/Titled.client.ts`),
                layouts: [],
            },
            {
                pattern: '/',
                load: async () => ({ default: mounts.home as PageMount }),
                layouts: [],
            },
        ],
        document.body,
    )
    await r.hydrate()
    let thrown = ''
    try {
        await r.go('/titled')
    } catch (error) {
        thrown = String(error)
    }
    flushSync()
    expect(thrown).toBe('')
    expect(document.title).toBe('Arrived')
    expect(document.querySelector('#titled h1')?.textContent).toBe('Arrived')
})

// 39.1, 39.6 — A COMPONENT'S HEAD TITLES THE PAGE IT IS ON, after a navigation as on the server. A
// docs page's `<head>` is its frame component's, and a navigation left the title the page the reader
// came from had set. THE REVERT: drop `contributed` from `emitClient`'s fills; the document keeps
// `Home`.
test("a navigated page's component titles the document — 39.1, 39.6", async () => {
    history.replaceState(null, '', '/')
    document.head.innerHTML = '<title>Home</title>'
    const mounts = await pages()
    const frame = parseAbide(`<head><title>Framed</title></head>
<main id="framed"><slot/></main>`)
    const page = parseAbide(`<script>
import Frame from './Frame.abide'
</script>
<Frame><p>inside</p></Frame>`)
    const dir = servedModules({
        'Frame.abide': {
            server: '',
            client: emitClient(
                frame,
                await session.reads(`${ROOT}src/Frame.abide`, frame),
                'invoked',
            ),
        },
        'Framed.abide': {
            server: '',
            client: emitClient(
                page,
                await session.reads(`${ROOT}src/Framed.abide`, page),
                'routed',
            ),
        },
    })
    const r = startRouter(
        [
            {
                pattern: '/framed',
                load: () => import(`${dir}/Framed.abide?client`),
                layouts: [],
            },
            {
                pattern: '/',
                load: async () => ({ default: mounts.home as PageMount }),
                layouts: [],
            },
        ],
        document.body,
    )
    await r.hydrate()
    await r.go('/framed')
    flushSync()
    expect(document.querySelector('#framed p')?.textContent).toBe('inside')
    expect(document.title).toBe('Framed')
})

// 39.13 — A HEAD FOLLOWS WHAT IT READS. A detail page's title reads the record it loads, which has
// not landed when the router mounts it — applied once, the tab said `Invoice` for as long as the
// page was open. THE REVERT: apply the head once in `emitClient`, as a static head is; the title
// stays `Invoice` after the value lands.
test("a navigated page's head follows a value that lands after the mount — 39.13", async () => {
    history.replaceState(null, '', '/')
    document.head.innerHTML = '<title>Home</title>'
    const mounts = await pages()
    const source = `<head><title>Invoice {number}</title></head>
<script>
import { reactive } from '@abide/abide'

const number = reactive(new Promise<string>((resolve) => {
    ;(globalThis as { landNumber?: (value: string) => void }).landNumber = resolve
}))
</script>
<main id="late">late</main>`
    const file = parseAbide(source)
    const reads = await session.reads(`${ROOT}src/Late.abide`, file)
    const dir = temporaryModule({
        'Late.client.ts': emitClient(file, reads, 'routed'),
    })
    const r = startRouter(
        [
            {
                pattern: '/late',
                load: () => import(`${dir}/Late.client.ts`),
                layouts: [],
            },
            {
                pattern: '/',
                load: async () => ({ default: mounts.home as PageMount }),
                layouts: [],
            },
        ],
        document.body,
    )
    await r.hydrate()
    await r.go('/late')
    flushSync()
    expect(document.title).toBe('Invoice')
    ;(globalThis as { landNumber?: (value: string) => void }).landNumber?.('42')
    await Promise.resolve()
    await Promise.resolve()
    flushSync()
    expect(document.title).toBe('Invoice 42')
})

// 39.6, 39.13 — A LIVE HEAD LANDS BEFORE THE FILL, as a static one does: the title the reader sees
// while the page builds is the page they are arriving at. The body reads `document.title` as it
// builds, which is the moment the head has to be there by.
//
// THE REVERT: apply a live head from its watch's first run, after the fill, rather than beside the
// static apply; the body reads `Home`.
test("a navigated page's live head is applied before its body builds — 39.6, 39.13", async () => {
    history.replaceState(null, '', '/')
    document.head.innerHTML = '<title>Home</title>'
    const mounts = await pages()
    const source = `<head><title>Early {number}</title></head>
<script>
import { reactive } from '@abide/abide'

const number = reactive(1)
</script>
<main id="early">{document.title}</main>`
    const file = parseAbide(source)
    const reads = await session.reads(`${ROOT}src/Early.abide`, file)
    const dir = temporaryModule({
        'Early.client.ts': emitClient(file, reads, 'routed'),
    })
    const r = startRouter(
        [
            {
                pattern: '/early',
                load: () => import(`${dir}/Early.client.ts`),
                layouts: [],
            },
            {
                pattern: '/',
                load: async () => ({ default: mounts.home as PageMount }),
                layouts: [],
            },
        ],
        document.body,
    )
    await r.hydrate()
    await r.go('/early')
    flushSync()
    expect(document.getElementById('early')?.textContent).toBe('Early 1')
    expect(document.title).toBe('Early 1')
})

// 39.6 — A FILE BOTH ROUTED AND INVOKED titles the document when the router mounts it, and
// leaves the head alone when a caller mounts it into a row. Both are empty regions, so the
// mount cannot tell them apart by the region: the router says so.
//
// THE REVERT: emit the head for `'routed'` alone in `emitClient`. The navigation then leaves the
// title `Home` where `Both` is due.
test('a page that is also a component applies its head only where it is routed — 39.6', async () => {
    history.replaceState(null, '', '/')
    document.head.innerHTML = '<title>Home</title>'
    const mounts = await pages()
    const file = parseAbide(
        '<head><title>Both</title></head><main id="both">both</main>',
    )
    const reads = await session.reads(`${ROOT}src/Both.abide`, file)
    const dir = temporaryModule({
        'Both.client.ts': emitClient(file, reads, 'both'),
    })
    const loaded = (await import(`${dir}/Both.client.ts`)) as {
        default: PageMount
    }
    const open = document.createComment(REGION_OPEN)
    const close = document.createComment(REGION_CLOSE)
    const row = document.createElement('li')
    row.append(open, close)
    loaded.default({ open, close })
    expect(row.textContent).toBe('both')
    expect(document.title).toBe('Home')

    const r = startRouter(
        [
            { pattern: '/both', load: async () => loaded, layouts: [] },
            {
                pattern: '/',
                load: async () => ({ default: mounts.home as PageMount }),
                layouts: [],
            },
        ],
        document.body,
    )
    await r.hydrate()
    await r.go('/both')
    flushSync()
    expect(document.title).toBe('Both')
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
    const settled = r.levels.at(-1)?.scope

    landInvoice()
    await superseded
    flushSync()

    expect(location.pathname).toBe('/')
    expect(document.querySelector('#invoice')).toBeNull()
    expect(document.querySelector('#home h1')?.textContent).toBe('Home')
    // AND THE WINNER'S SCOPE IS STILL THE ROUTER'S — the superseded mount never replaced it, so
    // there is no page left awake with nothing able to stop it.
    expect(r.levels.at(-1)?.scope).toBe(settled)
})

// 35.1 AND 41.11 ON THE CLIENT. A layout is mounted once and the page under it is what a
// navigation replaces — which is the whole reason to put chrome in a layout rather than in each
// page, and the one part of it a string assertion cannot see: the header keeps its scroll, an
// open menu stays open, and a component mid-load is still mid-load.
const CHROME = `<script>
import { reactive } from '@abide/abide'

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
        modules[`${name}.ts`] = emitComponent(file, reads, true)
        modules[`${name}.client.ts`] = emitClient(file, reads, 'routed')
    }
    const dir = temporaryModule(modules)
    const mount = async (name: string): Promise<PageMount> =>
        (await import(`${dir}/${name}.client.ts`)).default as PageMount

    // The document the SERVER painted for `/`: the page inside its layout, composed the one way
    // `answerRequest` composes it.
    const Layout = (await import(`${dir}/Chrome.ts`)).default
    const Home = (await import(`${dir}/Home.ts`)).default
    let html = ''
    html += new TextDecoder().decode(
        await renderDocument(
            () => composePage([Layout], Home, { params: () => ({}) }),
            '<!doctype html><html><head></head><body></body></html>',
        ),
    )

    return {
        layout: await mount('Chrome'),
        home: await mount('Home'),
        invoice: await mount('Invoice'),
        settings: await mount('Settings'),
        painted: html,
    }
}

// 10.5 — A PAGE IS A DESCENDANT OF ITS LAYOUT in the browser as on the server. The router mounts
// each level itself rather than inside the one above, so a page under a layout opened a share
// chain of its own: the server painted the layout's value, hydration overwrote it with the page's,
// and a write in the layout never reached the page. THE REVERT: drop the `resumeShare` around
// `module.default` in `Router.setUp` — the page reads `page-own` where `dark` is due.
test("a page under a layout reads the layout's share, hydrated and navigated to — 10.5", async () => {
    history.replaceState(null, '', '/')
    const sources = {
        Themed: `<script>
import { reactive } from '@abide/abide'

let theme = reactive.share('theme', () => reactive('dark'))
</script>

<div id="themed"><button id="lighten" onclick={() => { theme = 'light' }}>{theme}</button><slot/></div>`,
        First: `<script>
import { reactive } from '@abide/abide'

const theme = reactive.share('theme', () => reactive('page-own'))
</script>

<p id="first">{theme}</p>`,
        Second: `<script>
import { reactive } from '@abide/abide'

const theme = reactive.share('theme', () => reactive('page-own'))
</script>

<p id="second">{theme}</p>`,
    }
    const modules: Record<string, string> = {}
    for (const [name, source] of Object.entries(sources)) {
        const file = parseAbide(source)
        const reads = await session.reads(`${ROOT}src/${name}.abide`, file)
        modules[`${name}.ts`] = emitComponent(file, reads, true)
        modules[`${name}.client.ts`] = emitClient(file, reads, 'routed')
    }
    const dir = temporaryModule(modules)
    const client = async (name: string): Promise<PageMount> =>
        (await import(`${dir}/${name}.client.ts`)).default as PageMount
    const html = new TextDecoder().decode(
        await renderDocument(
            async () =>
                composePage(
                    [(await import(`${dir}/Themed.ts`)).default],
                    (await import(`${dir}/First.ts`)).default,
                    { params: () => ({}) },
                ),
            '<!doctype html><html><head></head><body></body></html>',
        ),
    )
    document.body.innerHTML = html.slice(
        html.indexOf('<body>') + '<body>'.length,
        html.indexOf('</body>'),
    )
    expect(document.querySelector('#first')?.textContent).toBe('dark')
    const layout = await client('Themed')
    const first = await client('First')
    const second = await client('Second')
    const themed = async (): Promise<{ default: PageMount }> => ({
        default: layout,
    })
    const r = startRouter([
        {
            pattern: '/second',
            load: async () => ({ default: second }),
            layouts: [themed],
        },
        {
            pattern: '/',
            load: async () => ({ default: first }),
            layouts: [themed],
        },
    ])
    await r.hydrate()
    flushSync()
    expect(document.querySelector('#first')?.textContent).toBe('dark')
    ;(document.querySelector('#lighten') as HTMLElement).click()
    flushSync()
    expect(document.querySelector('#first')?.textContent).toBe('light')

    await navigate('/second')
    flushSync()
    expect(document.querySelector('#second')?.textContent).toBe('light')
})

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

// 41.23 — ON THE CLIENT EVERY LEVEL IS SET UP BEFORE ANY IS HYDRATED, as 41.19 has the server set
// every level up before it builds any. A page's setup writes the crumbs its layout's `{#for}` reads: the server
// painted the layout with the crumb, so a client that hydrated the layout before the page's setup
// ran computed none where the document holds one. THE REVERT: have the emitted mount run its markup
// at once rather than leave it on the level (`deferredMarkup`); the layout hydrates inside its own
// setup call, and its list warns `holds 1 rows where this {#for} computes 0` and rebuilds.
test('a layout reads what its page set up, hydrating without a mismatch — 41.23', async () => {
    history.replaceState(null, '', '/')
    const files: Record<string, string> = {
        'crumbs.ts': `import { reactive } from '@abide/abide'\n\nexport const crumbs = reactive<string[]>([])\n`,
    }
    const sources = {
        Crumbed: `<script>
import { crumbs } from './crumbs.ts'
</script>

<div id="crumbed"><nav id="crumbs">{#for crumb of crumbs() by crumb}<a>{crumb}</a>{/for}</nav><slot/></div>`,
        Leaf: `<script>
import { crumbs } from './crumbs.ts'

crumbs.set(['Home'])
</script>

<main id="leaf">leaf</main>`,
    }
    for (const [name, source] of Object.entries(sources)) {
        const file = parseAbide(source)
        const reads = await session.reads(`${ROOT}src/${name}.abide`, file)
        files[`${name}.ts`] = emitComponent(file, reads, true)
        files[`${name}.client.ts`] = emitClient(file, reads, 'routed')
    }
    const dir = temporaryModule(files)
    const Layout = (await import(`${dir}/Crumbed.ts`)).default
    const Leaf = (await import(`${dir}/Leaf.ts`)).default
    let html = ''
    html += new TextDecoder().decode(
        await renderDocument(
            () => composePage([Layout], Leaf, { params: () => ({}) }),
            '<!doctype html><html><head></head><body></body></html>',
        ),
    )
    document.body.innerHTML = html.slice(
        html.indexOf('<body>') + '<body>'.length,
        html.indexOf('</body>'),
    )
    expect(document.querySelector('#crumbs')?.textContent).toBe('Home')
    // A browser arrives with nothing written, whatever this process's server half left behind.
    const { crumbs } = await import(`${dir}/crumbs.ts`)
    crumbs.set([])
    const painted = document.querySelector('#crumbs a')
    const layout = (await import(`${dir}/Crumbed.client.ts`))
        .default as PageMount
    const leaf = (await import(`${dir}/Leaf.client.ts`)).default as PageMount
    const r = startRouter([
        {
            pattern: '/',
            load: async () => ({ default: leaf }),
            layouts: [async () => ({ default: layout })],
        },
    ])
    const said: string[] = []
    const warn = console.warn
    console.warn = (...parts: unknown[]): void => {
        said.push(parts.map(String).join(' '))
    }
    try {
        await r.hydrate()
        flushSync()
    } finally {
        console.warn = warn
    }
    expect(said.filter((line) => line.includes('41.10'))).toEqual([])
    // HYDRATED WHERE IT STANDS, not rebuilt.
    expect(document.querySelector('#crumbs a')).toBe(painted)
})

// 39.9, 39.10 — A STAND-IN FOR THE BROWSER'S `startViewTransition`: the callback runs when the test
// releases it, the way a browser runs it a frame later, and `finished` settles only when the test
// says the animation is over. `undefined` removes it, which is a browser with no support.
function viewTransitions(): {
    calls: number
    types: (string[] | undefined)[]
    release: () => void
    finish: () => void
    finished: boolean
    remove: () => void
} {
    const pending: (() => void)[] = []
    const ends: (() => void)[] = []
    const stub = {
        calls: 0,
        types: [] as (string[] | undefined)[],
        finished: false,
        release: () => {
            for (const run of pending.splice(0)) run()
        },
        finish: () => {
            stub.finished = true
            for (const end of ends.splice(0)) end()
        },
        remove: () => {
            delete (document as { startViewTransition?: unknown })
                .startViewTransition
        },
    }
    Object.defineProperty(document, 'startViewTransition', {
        configurable: true,
        // 39.18, 39.19 — the callback alone, or the options form carrying the types.
        value: (
            given: (() => void) | { update: () => void; types: string[] },
        ) => {
            // A browser with no types reads the options form as a callback that is not one.
            const typed = (
                globalThis as { ViewTransition?: { prototype: object } }
            ).ViewTransition?.prototype
            if (typeof given !== 'function' && !(typed && 'types' in typed))
                throw new TypeError('startViewTransition: not a function')
            const update = typeof given === 'function' ? given : given.update
            stub.types.push(
                typeof given === 'function' ? undefined : given.types,
            )
            stub.calls += 1
            const updateCallbackDone = new Promise<void>((resolve) =>
                pending.push(() => {
                    update()
                    resolve()
                }),
            )
            const finished = new Promise<void>((resolve) => ends.push(resolve))
            return { updateCallbackDone, finished, ready: updateCallbackDone }
        },
    })
    return stub
}

async function until(done: () => boolean): Promise<void> {
    for (let turn = 0; turn < 100 && !done(); turn += 1)
        await new Promise((resolve) => setTimeout(resolve, 0))
}

// 39.9 — THE NAVIGATION IS OVER WHEN THE DOM IS WRITTEN, while the animation is still playing.
// THE REVERT: await `finished` in `Router.write` rather than `updateCallbackDone`; `navigated`
// stays false with the invoice already on screen, and the test times out waiting on it.
test('a view transition is awaited to the write, not to the animation — 39.9', async () => {
    history.replaceState(null, '', '/')
    const transition = viewTransitions()
    try {
        const r = router(await pages(), true)
        await r.hydrate()
        let navigated = false
        const going = navigate('/invoices/42').then(() => {
            navigated = true
        })
        await until(() => transition.calls === 1)
        // CAPTURED, NOT YET WRITTEN: the outgoing page is what the browser snapshots.
        expect(document.querySelector('#home')).not.toBeNull()
        transition.release()
        await going
        flushSync()
        expect(navigated).toBe(true)
        expect(transition.finished).toBe(false)
        expect(document.querySelector('#invoice h1')?.textContent).toBe(
            'Invoice',
        )
        transition.finish()
    } finally {
        transition.remove()
    }
})

// 39.7 — NOTHING IN THE STYLES, NO TRANSITION, even in a browser that has them. THE REVERT: drop
// `this.transitions` from `Router.write`'s guard; the one navigation calls the browser once.
test('a build whose styles name no view transition never starts one — 39.7', async () => {
    history.replaceState(null, '', '/')
    const transition = viewTransitions()
    try {
        const r = router(await pages())
        await r.hydrate()
        await navigate('/invoices/42')
        flushSync()
        expect(transition.calls).toBe(0)
        expect(document.querySelector('#invoice h1')?.textContent).toBe(
            'Invoice',
        )
    } finally {
        transition.remove()
    }
})

// 39.10 — A BROWSER WITH NO SUPPORT NAVIGATES AS IT OTHERWISE WOULD. happy-dom has no
// `startViewTransition`, which is the browser this case is. THE REVERT: call it unguarded; the
// navigation rejects with a TypeError and the invoice never mounts.
test('a browser without view transitions navigates as it would with none — 39.10', async () => {
    history.replaceState(null, '', '/')
    expect(
        typeof (document as { startViewTransition?: unknown })
            .startViewTransition,
    ).toBe('undefined')
    const r = router(await pages(), true)
    await r.hydrate()
    await navigate('/invoices/42')
    flushSync()
    expect(document.querySelector('#invoice h1')?.textContent).toBe('Invoice')
})

// 39.9 — A TRANSITION ANOTHER NAVIGATION OVERTOOK WRITES NOTHING. The browser runs a callback a
// frame after it was handed one, and runs it even for a transition it skipped. THE REVERT: drop the
// ticket check inside `Router.write`'s callback; the superseded invoice mounts once (1 against 0)
// before the home page replaces it.
test('a view transition a later navigation overtook writes nothing — 39.9', async () => {
    history.replaceState(null, '', '/')
    const transition = viewTransitions()
    try {
        const mounts = await pages()
        let invoiceMounts = 0
        const invoice = mounts.invoice as PageMount
        mounts.invoice = (region, props) => {
            invoiceMounts += 1
            return invoice(region, props)
        }
        const r = router(mounts, true)
        await r.hydrate()
        const first = navigate('/invoices/42')
        await until(() => transition.calls === 1)
        const second = navigate('/')
        await until(() => transition.calls === 2)
        transition.release()
        await Promise.all([first, second])
        flushSync()
        expect(invoiceMounts).toBe(0)
        expect(location.pathname).toBe('/')
        expect(document.querySelector('#home h1')?.textContent).toBe('Home')
    } finally {
        transition.remove()
    }
})

// 30.23, 30.24, 30.25 — THE ROUTE STANDING, AT ANOTHER QUERY: a filter written to the address. The page
// reads the address through `route`, so it follows rather than being rebuilt — the count the reader
// bumped, and the focus a search box would hold, stay — nothing is asked, and the scroll stays put.
// THE REVERT: drop the same-route, same-path `follow` branch from `go`; this reports `asked` as
// ['/'], a new scope, the count back at 0 and the page scrolled to the top.
test('a navigation that moves only the query keeps the page — 30.23, 30.24, 30.25', async () => {
    history.replaceState(null, '', '/')
    const r = router(await pages())
    await r.hydrate()
    flushSync()
    ;(document.querySelector('#bump') as HTMLElement).click()
    flushSync()
    const scope = r.levels.at(-1)?.scope
    const scrolled: unknown[] = []
    const scrollTo = globalThis.scrollTo
    globalThis.scrollTo = ((...to: unknown[]) => {
        scrolled.push(to)
    }) as typeof globalThis.scrollTo
    try {
        await navigate('/?genre=fantasy', { replace: true })
        flushSync()
    } finally {
        globalThis.scrollTo = scrollTo
    }
    expect(asked).toEqual([])
    expect(r.levels.at(-1)?.scope).toBe(scope)
    expect(document.querySelector('#home p')?.textContent).toBe('1')
    expect(route.url().search).toBe('?genre=fantasy')
    expect(location.search).toBe('?genre=fantasy')
    expect(scrolled).toEqual([])
})

// 30.23, 30.24 — THE ROUTE STANDING, AT ANOTHER PATH: a season chosen under one series. `middleware`
// is asked about the new path, and the page it matched is the one mounted, so it follows: the same
// nodes, the same scope, and `route.params` moved. THE REVERT: drop the `landing.route ===
// this.standing` branch from `go`; the page is rebuilt, a new `<h1>` and a new scope.
test('a navigation to another path of the same route asks, and keeps the page — 30.23, 30.24', async () => {
    history.replaceState(null, '', '/')
    const r = router(await pages())
    await r.hydrate()
    await navigate('/invoices/42')
    flushSync()
    const scope = r.levels.at(-1)?.scope
    const heading = document.querySelector('#invoice h1')
    asked.length = 0
    await navigate('/invoices/7')
    flushSync()
    expect(asked).toEqual(['/invoices/7'])
    expect(r.levels.at(-1)?.scope).toBe(scope)
    expect(document.querySelector('#invoice h1')).toBe(heading)
    expect(route.params()).toEqual({ id: '7' })
    expect(location.pathname).toBe('/invoices/7')
})

// A STEP THAT MOVES ONLY THE FRAGMENT IS NOT A NAVIGATION. Back over an in-page `#setup` jump
// fires `popstate` on an entry whose page is the one standing, and remounting it threw away every
// piece of state the reader had — for a middleware round trip nobody asked for. The count the
// reader bumped is the state, and the scope is how a remount that rebuilt the same text shows.
//
// THE REVERT: have `onPop` call `router.go` for every step; this reports `asked` as ['/'] where
// [] is due, and the count back at 0.
test('back over a fragment of the standing page neither asks nor remounts', async () => {
    history.replaceState(null, '', '/')
    const r = router(await pages())
    await r.hydrate()
    flushSync()
    const stop = listenForRoutes(r)
    ;(document.querySelector('#bump') as HTMLElement).click()
    flushSync()
    const scope = r.levels.at(-1)?.scope

    // What the browser does for `<a href="#setup">` and then Back: the entry pushed, and the bar
    // moved back to the one before it before `popstate` is dispatched.
    history.pushState(null, '', '/#setup')
    history.replaceState(null, '', '/')
    dispatchEvent(new PopStateEvent('popstate'))
    await Bun.sleep(0)
    flushSync()

    expect(asked).toEqual([])
    expect(r.levels.at(-1)?.scope).toBe(scope)
    expect(document.querySelector('#home p')?.textContent).toBe('1')
    expect(route.url().href).toBe(location.href)
    stop()
})

// THE BROWSER'S FRAGMENT NAVIGATION, KEPT. A routed link to `/#install` from `/` is a jump within
// the page: nothing asked, nothing remounted, the entry pushed and the element brought into view.
// A link carrying a fragment to ANOTHER route mounts it and then does the same, where the top of
// the page is what an address with no fragment gets.
//
// THE REVERT: drop the fragment check from `go` and write `scrollTo(0, 0)` after the mount, as
// `commit` did; the in-page link reports `asked` as ['/'] and nothing scrolled into view, and the
// cross-route one reports [] where ['lines'] is due.
test('a routed link with a fragment scrolls to its element, remounting nothing it shares', async () => {
    history.replaceState(null, '', '/')
    const r = router(await pages())
    await r.hydrate()
    flushSync()
    const stop = listenForRoutes(r)
    const scrolled: string[] = []
    const into = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element): void {
        scrolled.push(this.id)
    }
    try {
        // Outside the page region, so a navigation leaves them standing.
        for (const id of ['install', 'lines']) {
            const target = document.createElement('p')
            target.id = id
            document.body.append(target)
        }
        const scope = r.levels.at(-1)?.scope
        const link = document.createElement('a')
        link.href = '/#install'
        document.body.append(link)
        const click = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            button: 0,
        })
        link.dispatchEvent(click)
        expect(click.defaultPrevented).toBe(true)
        await Bun.sleep(0)
        flushSync()
        expect(asked).toEqual([])
        expect(r.levels.at(-1)?.scope).toBe(scope)
        expect(location.hash).toBe('#install')
        expect(scrolled).toEqual(['install'])

        scrolled.length = 0
        await navigate('/invoices/42#lines')
        flushSync()
        expect(document.querySelector('#invoice h1')?.textContent).toBe(
            'Invoice',
        )
        expect(scrolled).toEqual(['lines'])
    } finally {
        Element.prototype.scrollIntoView = into
        stop()
    }
})

// 33.5 AND 41.11 TOGETHER: A KEPT LAYOUT READS THE ADDRESS IT IS STANDING AT NOW. Kept across a
// navigation, a layout is not mounted again, so whatever its props and its `<slot/>` read has to
// be read at the moment it is used rather than captured when the layout first mounted.
const USERS = `<script>
import { props, reactive } from '@abide/abide'

const { params } = props<{ params: { id: string } }>()
let open = reactive(true)
</script>

<div id="users"><h2 id="who">user {params.id}</h2><button id="fold" onclick={() => { open = !open }}>fold</button>{#if open}<slot/>{/if}</div>`

const PROFILE = `<script>
import { props } from '@abide/abide'

const { params } = props<{ params: { id: string } }>()
</script>

<main id="profile">profile {params.id}</main>`

const EDIT = `<script>
import { reactive } from '@abide/abide'

let saved = reactive(0)
</script>

<main id="edit">edit {saved}</main>`

async function users() {
    const modules: Record<string, string> = {}
    for (const [name, source] of Object.entries({
        Users: USERS,
        Profile: PROFILE,
        Edit: EDIT,
    })) {
        const file = parseAbide(source)
        const reads = await session.reads(`${ROOT}src/${name}.abide`, file)
        modules[`${name}.client.ts`] = emitClient(file, reads, 'routed')
    }
    const dir = temporaryModule(modules)
    const mount = async (name: string): Promise<PageMount> =>
        (await import(`${dir}/${name}.client.ts`)).default as PageMount
    const layout = await mount('Users')
    const profile = await mount('Profile')
    const edit = await mount('Edit')
    const wrapping = async (): Promise<{ default: PageMount }> => ({
        default: layout,
    })
    // The empty page region, so the first navigation builds the chain from its templates.
    document.body.innerHTML = `<!--${REGION_OPEN}--><!--${REGION_CLOSE}-->`
    history.replaceState(null, '', '/elsewhere')
    return startRouter([
        {
            pattern: '/users/[id]/edit',
            load: async () => ({ default: edit }),
            layouts: [wrapping],
        },
        {
            pattern: '/users/[id]',
            load: async () => ({ default: profile }),
            layouts: [wrapping],
        },
    ])
}

// THE REVERT: hand the layout `params: () => params` over the params it was mounted with, as
// `paramsProp` did; this reports "user 1" where "user 2" is due.
test("a kept layout's params prop reads the address it stands at — 33.5, 41.11", async () => {
    const r = await users()
    await r.go('/users/1')
    flushSync()
    expect(document.querySelector('#who')?.textContent).toBe('user 1')
    const kept = document.querySelector('#users')
    await r.go('/users/2')
    flushSync()
    expect(document.querySelector('#users')).toBe(kept)
    expect(document.querySelector('#profile')?.textContent).toBe('profile 2')
    expect(document.querySelector('#who')?.textContent).toBe('user 2')
})

// A `<slot/>` WHOSE REGION IS REBUILT. Folded, the page in it leaves with it and is stopped; a
// navigation while it is folded mounts nothing into a region no longer in the document; and
// unfolded, the slot mounts the page the address resolves to NOW — not the one the layout was
// first mounted with.
//
// THE REVERT, IN TWO HALVES. Have the slot's `mount` hand back nothing, as `mountFrom` did, and
// folding leaves the edit page standing — 2 levels where 1 is due, its scope still awake. Have it
// mount from the chain captured when the layout mounted, and unfolding puts back the profile the
// layout was first mounted over, and `#edit` is missing where "edit 0" is due.
test("a kept layout's slot mounts the current page whenever it opens — 35.1, 12.13", async () => {
    const r = await users()
    await r.go('/users/1')
    await r.go('/users/1/edit')
    flushSync()
    expect(document.querySelector('#edit')?.textContent).toBe('edit 0')
    const editing = r.levels.at(-1)
    expect(editing?.scope?.stops.length).toBeGreaterThan(0)
    ;(document.querySelector('#fold') as HTMLElement).click()
    flushSync()
    expect(document.querySelector('#edit')).toBeNull()
    expect(r.levels).toHaveLength(1)
    expect(editing?.scope?.stops.length).toBe(0)

    ;(document.querySelector('#fold') as HTMLElement).click()
    flushSync()
    expect(document.querySelector('#edit')?.textContent).toBe('edit 0')
    expect(document.querySelector('#profile')).toBeNull()

    ;(document.querySelector('#fold') as HTMLElement).click()
    flushSync()
    await r.go('/users/2')
    flushSync()
    expect(document.querySelector('#who')?.textContent).toBe('user 2')
    expect(document.querySelector('#profile')).toBeNull()

    ;(document.querySelector('#fold') as HTMLElement).click()
    flushSync()
    expect(document.querySelector('#profile')?.textContent).toBe('profile 2')
    expect(document.querySelector('#edit')).toBeNull()
    expect(r.levels).toHaveLength(2)
})

// 39.14 — WHAT A LEAVING LEVEL KEYED AND NO ARRIVING ONE DOES GOES BACK TO THE NEXT-OUTER
// CONTRIBUTOR, or leaves. The server paints each address with one entry per key, the deepest's
// (39.4), so the client has to end where that paint would: a title the reader left standing is
// a tab naming a page they are no longer on.
//

async function withdrawing() {
    const sources: Record<string, string> = {
        Section: `<head><title>Section</title><meta name="description" content="section"></head>
<section id="section"><slot/></section>`,
        Titled: `<head><title>Home</title><meta name="description" content="home"></head>
<main id="titled">titled</main>`,
        Plain: '<main id="plain">plain</main>',
        Described: `<head><meta name="description" content="described"></head>
<main id="described">described</main>`,
        Bare: '<main id="bare">bare</main>',
        Robots: `<head><meta name="robots" content="noindex"></head>
<main id="robots">robots</main>`,
    }
    const modules: Record<string, string> = {}
    for (const [name, source] of Object.entries(sources)) {
        const file = parseAbide(source)
        const reads = await session.reads(`${ROOT}src/${name}.abide`, file)
        modules[`${name}.ts`] = emitComponent(file, reads, true)
        modules[`${name}.client.ts`] = emitClient(file, reads, 'routed')
    }
    const dir = temporaryModule(modules)
    const loaded = async (name: string): Promise<{ default: PageMount }> =>
        await import(`${dir}/${name}.client.ts`)
    const section = () => loaded('Section')
    // THE SERVER'S PAINT OF `/`.
    const Titled = (await import(`${dir}/Titled.ts`)).default
    const html = new TextDecoder().decode(
        await renderDocument(
            Titled,
            '<!doctype html><html><head></head><body></body></html>',
        ),
    )
    document.head.innerHTML = html.slice(
        html.indexOf('<head>') + '<head>'.length,
        html.indexOf('</head>'),
    )
    document.body.innerHTML = html.slice(
        html.indexOf('<body>') + '<body>'.length,
        html.indexOf('</body>'),
    )
    history.replaceState(null, '', '/')
    const r = startRouter(
        [
            { pattern: '/', load: () => loaded('Titled'), layouts: [] },
            { pattern: '/plain', load: () => loaded('Plain'), layouts: [] },
            { pattern: '/robots', load: () => loaded('Robots'), layouts: [] },
            {
                pattern: '/section/described',
                load: () => loaded('Described'),
                layouts: [section],
            },
            {
                pattern: '/section/bare',
                load: () => loaded('Bare'),
                layouts: [section],
            },
        ],
        document.body,
    )
    await r.hydrate()
    return r
}

const description = (): string | null | undefined =>
    document.head
        .querySelector('meta[name="description"]')
        ?.getAttribute('content')

// THE REVERT, TWICE. Return from `withdrawHead` at its top, and `/plain` keeps the title `Home`
// the page it left painted. Leave the head on the level only where the region is empty (inside
// `emitClient`'s `isEmptyRegion` branch), and it still does: the painted page never said what it
// keyed, so there is nothing to withdraw.
test('a page leaving a title the next page has none of takes it with it — 39.14', async () => {
    const r = await withdrawing()
    expect(document.title).toBe('Home')
    // THE SERVER'S PAINT: one title, the page's.
    expect(document.head.querySelectorAll('title')).toHaveLength(1)
    await r.go('/plain')
    flushSync()
    expect(document.querySelector('#plain')?.textContent).toBe('plain')
    expect(document.head.querySelectorAll('title')).toHaveLength(0)
    expect(description()).toBeUndefined()
})

// A KEPT LAYOUT IS AN OUTER CONTRIBUTOR: the page that overrode its description leaves, the
// layout stays, and the layout's is what the server would paint.
// THE REVERT: pass no outer heads in `Router.commit`; the description leaves where `section` is due.
test("a page overriding its layout's description hands it back to a sibling with none — 39.14", async () => {
    const r = await withdrawing()
    await r.go('/section/described')
    flushSync()
    expect(description()).toBe('described')
    const kept = document.querySelector('#section')
    await r.go('/section/bare')
    flushSync()
    expect(document.querySelector('#section')).toBe(kept)
    expect(description()).toBe('section')
    expect(document.title).toBe('Section')
    expect(
        document.head.querySelectorAll('meta[name="description"]'),
    ).toHaveLength(1)
})

// NO OUTER CONTRIBUTOR HAS THE KEY, so the entry leaves with the page that keyed it.
// THE REVERT: skip the `remove()` for a key nothing outer holds in `withdrawHead`; the next page
// is served `noindex`, which is 1 where 0 is due.
test('a key no outer contributor has is removed with the page that keyed it — 39.14', async () => {
    const r = await withdrawing()
    await r.go('/robots')
    flushSync()
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(
        1,
    )
    await r.go('/plain')
    flushSync()
    expect(document.head.querySelectorAll('meta[name="robots"]')).toHaveLength(
        0,
    )
})

// 12.4, 41.19 — A ROUTED LEVEL'S SETUP RUNS BEFORE ITS MARKUP, AND ITS WATCHES ARE STOPPED WITH THE
// LEVEL EVEN WHERE THAT MARKUP NEVER RUNS. A layout whose `<slot/>` stands in a closed `{#if}` never
// mounts the page below it, so the page's markup is never run — and the page's setup has run. THE
// REVERT: have a deferred level answer nothing (`return` in `deferredMarkup`) — the page's watch is
// disposed 0 times where 1 is due when the reader leaves, and wakes again at the next write.
test("a page's setup watch stops with its level when its layout's slot never opened — 12.4", async () => {
    history.replaceState(null, '', '/')
    const mounts = await pages()
    const counted = globalThis as { innerRuns?: number; innerDisposed?: number }
    counted.innerRuns = 0
    counted.innerDisposed = 0
    const sources = {
        Shut: `<script>
import { reactive } from '@abide/abide'

const open = reactive(false)
</script>
<div id="shut">{#if open}<slot/>{/if}</div>`,
        Inner: `<script>
import { watch } from '@abide/abide'
import { tick } from './tick.ts'

watch(() => {
    tick()
    ;(globalThis as { innerRuns: number }).innerRuns += 1
    return () => {
        ;(globalThis as { innerDisposed: number }).innerDisposed += 1
    }
})
</script>
<main id="inner">inner</main>`,
    }
    const files: Record<string, string> = {
        'tick.ts': `import { reactive } from '@abide/abide'\n\nexport const tick = reactive(0)\n`,
    }
    for (const [name, source] of Object.entries(sources)) {
        const file = parseAbide(source)
        const reads = await session.reads(`${ROOT}src/${name}.abide`, file)
        files[`${name}.client.ts`] = emitClient(file, reads, 'routed')
    }
    const dir = temporaryModule(files)
    const r = startRouter(
        [
            {
                pattern: '/inner',
                load: () => import(`${dir}/Inner.client.ts`),
                layouts: [() => import(`${dir}/Shut.client.ts`)],
            },
            {
                pattern: '/',
                load: async () => ({ default: mounts.home as PageMount }),
                layouts: [],
            },
        ],
        document.body,
    )
    await r.hydrate()
    await r.go('/inner')
    flushSync()
    expect(document.querySelector('#shut')).not.toBeNull()
    expect(document.querySelector('#inner')).toBeNull()
    expect(counted.innerRuns).toBe(1)
    await r.go('/')
    flushSync()
    expect(counted.innerDisposed).toBe(1)
    const { tick } = await import(`${dir}/tick.ts`)
    tick.set(1)
    flushSync()
    expect(counted.innerRuns).toBe(1)
})

// 32.66 — A PAGE LEAVING UNDER AN EXIT IS NOT THE ARRIVING PAGE'S MARKUP. The router stops the
// leaving page first, so its exit holds `#home` (32.38) through the emptying of the region the
// arriving page then mounts against. THE REVERT, run: drop the anchor move from `emptyRegion`; the
// held `#home` makes the region look painted, the invoice adopts it rather than building, and
// `#invoice` never arrives.
test('a page leaving under an exit is not adopted by the page arriving — 32.66', async () => {
    history.replaceState(null, '', '/')
    const exits: (() => void)[] = []
    ;(globalThis as { __EXIT__?: () => Promise<void> }).__EXIT__ = () =>
        new Promise<void>((done) => exits.push(done))
    const r = router(
        await pages(
            undefined,
            `<script>
const exit = () => () => (globalThis as { __EXIT__?: () => Promise<void> }).__EXIT__?.()
</script>

<main id="home" bind:element={exit}><h1>Home</h1></main>`,
        ),
    )
    await r.hydrate()
    flushSync()
    await navigate('/invoices/42')
    flushSync()
    expect(exits.length).toBe(1)
    expect(document.querySelector('#home')).not.toBeNull()
    expect(document.querySelector('#invoice h1')?.textContent).toBe('Invoice')
    expect(document.querySelectorAll('#invoice li').length).toBe(2)
    // OUTSIDE THE ANCHORS, so the next emptiness test and the next hydration walk never see it.
    expect(r.region.open.nextSibling).toBe(document.querySelector('#invoice'))
    for (const done of exits) done()
    await Promise.resolve()
    await Promise.resolve()
    expect(document.querySelector('#home')).toBeNull()
    expect(document.querySelector('#invoice h1')?.textContent).toBe('Invoice')
})

// What the browser does for Back or Forward: the bar moved to the entry, its state with it, and
// `popstate` dispatched after.
async function step(state: unknown, address: string): Promise<void> {
    history.replaceState(state, '', address)
    dispatchEvent(new PopStateEvent('popstate'))
    await until(
        () => location.pathname === new URL(address, location.href).pathname,
    )
    await Bun.sleep(0)
    flushSync()
}

// 30.29 — BACK AND FORWARD TO A REMOUNTED PAGE LAND WHERE THE READER LEFT IT. The browser's own
// restoration runs before the page it restores exists, so it is off while routes are listened for
// and the router puts each entry's scroll back once its page is mounted. The states the steps
// carry hold no scroll, so what is restored is what the router remembered as each entry was left.
// THE REVERT, run: drop the `step.scroll` restore from `commit`; back stays at 120 where 300 is due.
test('back and forward restore the scroll each entry was left at — 30.29', async () => {
    history.replaceState(null, '', '/')
    const r = router(await pages())
    await r.hydrate()
    const stop = listenForRoutes(r)
    try {
        expect(history.scrollRestoration).toBe('manual')
        const home = history.state as { index: number }
        scrollTo(0, 300)
        await navigate('/invoices/42')
        flushSync()
        expect(scrollY).toBe(0)
        // THE ENTRY LEFT BY A PUSH carries its scroll, for a reload to find.
        expect((history.state as { index: number }).index).toBe(home.index + 1)
        scrollTo(0, 120)

        await step({ index: home.index, scroll: null }, '/')
        expect(document.querySelector('#home h1')?.textContent).toBe('Home')
        expect(scrollY).toBe(300)

        await step({ index: home.index + 1, scroll: null }, '/invoices/42')
        expect(document.querySelector('#invoice h1')?.textContent).toBe(
            'Invoice',
        )
        expect(scrollY).toBe(120)
    } finally {
        stop()
        scrollTo(0, 0)
    }
    expect(history.scrollRestoration).toBe('auto')
})

// 30.30 THROUGH A RELOAD: the scroll the entry was written with on the way out is where the
// hydrated page lands. THE REVERT, run: drop the restore from `hydrate`; the page stays at 0.
test('a reloaded entry hydrates at the scroll it was left at — 30.30', async () => {
    history.replaceState({ index: 4, scroll: [0, 250] }, '', '/')
    const r = router(await pages())
    expect(r.index).toBe(4)
    await r.hydrate()
    expect(scrollY).toBe(250)
    scrollTo(0, 0)
})

// 30.31 — A SUPERSEDED NAVIGATION'S REQUEST IS ABORTED, not left to finish for nobody. THE REVERT,
// run: drop the `abort()` from `supersede`; the first request's signal reads not aborted.
test('a superseded navigation aborts its middleware request — 30.31', async () => {
    history.replaceState(null, '', '/')
    const r = router(await pages())
    await r.hydrate()
    const superseded = r.go('/invoices/42')
    const winner = r.go('/?tab=2')
    await Promise.all([superseded, winner])
    flushSync()
    expect(asked).toEqual(['/invoices/42'])
    expect(signals[0]?.aborted).toBe(true)
    expect(document.querySelector('#home h1')?.textContent).toBe('Home')
})

// 39.18 — A NAVIGATION'S TRANSITION IS TYPED WITH ITS DIRECTION, so the stylesheet decides what a
// back step looks like. 39.19 — a browser with no transition types is handed the callback alone.
// THE REVERTS, run: hand `startViewTransition` the callback whatever the browser takes, and the
// types read [undefined, …] where push, back and forward are due; hand it the options form
// whatever the browser takes, and every transition test throws the TypeError such a browser does.
test('a view transition carries the direction it moved in — 39.18, 39.19', async () => {
    history.replaceState(null, '', '/')
    const transition = viewTransitions()
    const typed = (globalThis as { ViewTransition?: unknown }).ViewTransition
    ;(globalThis as { ViewTransition?: unknown }).ViewTransition = class {
        types = new Set<string>()
    }
    Object.defineProperty(
        (globalThis as { ViewTransition: { prototype: object } }).ViewTransition
            .prototype,
        'types',
        { value: new Set<string>() },
    )
    const r = router(await pages(), true)
    await r.hydrate()
    const stop = listenForRoutes(r)
    // Each navigation's transition, released once the browser has been handed it.
    const released = async (calls: number): Promise<void> => {
        await until(() => transition.calls === calls)
        transition.release()
        await Bun.sleep(0)
        flushSync()
    }
    try {
        const home = (history.state as { index: number }).index
        const going = navigate('/invoices/42')
        await released(1)
        await going
        history.replaceState({ index: home, scroll: null }, '', '/')
        dispatchEvent(new PopStateEvent('popstate'))
        await released(2)
        await until(() => document.querySelector('#home') !== null)
        history.replaceState(
            { index: home + 1, scroll: null },
            '',
            '/invoices/42',
        )
        dispatchEvent(new PopStateEvent('popstate'))
        await released(3)
        await until(() => document.querySelector('#invoice') !== null)
        expect(transition.types).toEqual([['push'], ['back'], ['forward']])

        // 39.19 — NO TYPES: the callback form, and the navigation still writes.
        ;(globalThis as { ViewTransition?: unknown }).ViewTransition = typed
        const untyped = navigate('/')
        await released(4)
        await untyped
        expect(transition.types[3]).toBeUndefined()
        expect(document.querySelector('#home h1')?.textContent).toBe('Home')
    } finally {
        stop()
        transition.remove()
        ;(globalThis as { ViewTransition?: unknown }).ViewTransition = typed
    }
})
