// Routing: which page a URL names, and what that page may ask about the caller that asked for it.
//
// `route()` is an AMBIENT, like `request()` — it answers about the caller's own context — but unlike
// the others it has to be reactive, because a client changes it without a new caller arriving. So it
// is a facade over four small cells rather than one record: a query-only navigation writes `url` and
// nothing else, and a reader of `params` stays asleep for it. A record rebuilt per navigation makes
// that impossible, for the same reason `refreshing` is its own node rather than a field of a status
// object — a freshly built wrapper defeats every identity check downstream of it.
//
// The cells are PER-CALLER, through the same storage a memo's cache uses. On a client that is one
// caller forever and the module-level pair is used directly; inside a `serve` each request answers
// about its own URL; inside an `isolate` a test drives a route without touching the document.
//
// Nothing here reaches the DOM, not even through `globalThis`. Both edges are INSTALLED: `abide/server`
// hands over the request's URL, `abide/ui` hands over the document's address bar. What stays here is
// the policy — only the AMBIENT caller drives that address bar, because a request being served and a
// test driving a route on the side each have a scope of their own, and the document has only one.

import { html, type TemplateResult } from './html.ts'
import {
    buildPath,
    comparePatterns,
    matchPattern,
    NO_PARAMS,
    type Params,
    type Pattern,
    parsePattern,
    splitPath,
} from './internal/patterns.ts'
import { isThenable } from './internal/probes.ts'
import { currentScope, storeFor } from './internal/scopes.ts'
import { type State, state } from './reactive.ts'

export type { Params } from './internal/patterns.ts'

/** What a page or a layout IS: the same callable a `.abide` file compiles to. */
export type View = (args: Record<string, unknown>) => TemplateResult

/** A module holding one. The DEFAULT export, because that is what a compiled `.abide` file has. */
export interface ViewModule {
    default: View
}

/**
 * How a view is reached. A thunk rather than the view itself, because the point of a route table is
 * that a page's code need not be in the bundle before anyone asks for that page — and because
 * `() => import('./page.abide')` is then the ordinary spelling rather than a special one. A table
 * written by hand hands its module back in the call, and nothing about that is async.
 */
export type Loader = () => ViewModule | Promise<ViewModule>

export interface RouteEntry {
    /** The pattern: `/`, `/users/[id]`, `/files/[...path]`. This is the route's NAME. */
    path: string
    page: Loader
    /** The layouts wrapping it, OUTERMOST first. Each receives the level below as its children. */
    layouts?: Loader[]
}

export type RouteKind = 'page' | 'missing'

/**
 * The route being served. A stable object whose properties are READS: asking for one subscribes the
 * caller to that property alone, so a navigation that only moves the query wakes only the readers of
 * `url`.
 */
export interface Route {
    /** The pattern that matched, or `''` when nothing did. */
    readonly name: string
    readonly kind: RouteKind
    readonly params: Params
    readonly url: URL
    /** A navigation is in flight — a page whose module has not arrived yet. */
    readonly navigating: boolean
}

export interface NavigateOptions {
    /** Replace the current history entry instead of pushing a new one. */
    replace?: boolean
    /** Leave the scroll position alone. A same-path navigation never scrolls anyway. */
    keepScroll?: boolean
}

const SETTLED: Promise<void> = Promise.resolve()

// The origin a caller with no document and no request resolves a path against — a script, or a test
// driving a route on the side. Only the path is ever read back out of it.
const NOWHERE = 'http://localhost/'

// --- the table ---------------------------------------------------------------
//
// One table per app, module-level: a route table is the app's SHAPE, not something a caller owns.
// The resolved views live here too, for the same reason a `{ global }` memo does — a module is
// loaded once per process however many requests ask for it.

interface Installed {
    pattern: Pattern
    page: Loader
    layouts: Loader[]
    /**
     * The page itself, null until its module lands. Reactive and the ONLY record of that fact, so a
     * slot that rendered nothing while the page was loading wakes when it is not, and there is no
     * second flag beside it for a load to keep in step.
     */
    view: State<View | null>
    wraps: View[]
    /** The load in flight, so two askers share one. Cleared however it ends. */
    loading: Promise<void> | null
}

/** What a path resolved to: the route it hit and the params it gave up. `null` is "nothing did". */
interface Match {
    held: Installed
    params: Params
}

let TABLE: Installed[] = []
const BY_NAME = new Map<string, Installed>()

const NO_ARGS: Record<string, unknown> = Object.freeze({})
const NO_WRAPS: View[] = []
const NO_LAYOUTS: Loader[] = []
// Renders nothing: no route matched, or its module has not arrived. ONE call site, so the identity a
// renderer keys its parsed template on stays stable across every route that has nothing to show.
const NOTHING = html``

/**
 * Install the app's routes. Sorted ONCE, by precedence — literal > required > optional > rest — so a
 * match is a walk that stops at the first hit rather than a score kept over every route.
 */
export function routes(table: RouteEntry[]): void {
    const installed: Installed[] = []
    for (const entry of table) {
        installed.push({
            pattern: parsePattern(entry.path),
            page: entry.page,
            layouts: entry.layouts ?? NO_LAYOUTS,
            view: state<View | null>(null),
            wraps: NO_WRAPS,
            loading: null,
        })
    }
    installed.sort((left, right) => comparePatterns(left.pattern, right.pattern))
    TABLE = installed
    BY_NAME.clear()
    for (const held of installed) BY_NAME.set(held.pattern.path, held)
    // A table installed after something already asked where it is — a test, or an app declaring its
    // routes late — has to re-answer that question, or the caller keeps the answer it was given by a
    // table that no longer exists.
    const here = hereFor()
    if (here.cells !== null) {
        const url = here.cells.url.peek()
        commit(here.cells, url, lookup(url.pathname))
    }
}

function lookup(pathname: string): Match | null {
    const parts = splitPath(pathname)
    for (let i = 0; i < TABLE.length; i++) {
        const held = TABLE[i] as Installed
        const params = matchPattern(held.pattern, parts)
        if (params !== null) return { held, params }
    }
    return null
}

function viewOf(module: ViewModule, path: string): View {
    const view = module.default
    if (typeof view !== 'function') {
        throw new Error(
            `abide: the module for "${path}" has no default export — a page IS its default export`,
        )
    }
    return view
}

function adoptModules(held: Installed, parts: ViewModule[]): void {
    const path = held.pattern.path
    const wraps: View[] = []
    for (let i = 0; i < parts.length - 1; i++) wraps.push(viewOf(parts[i] as ViewModule, path))
    held.wraps = wraps
    held.view.set(viewOf(parts[parts.length - 1] as ViewModule, path))
}

/**
 * Resolve one route's modules. `null` when there is nothing to wait for — which is the whole reason
 * this is not simply `async`: a table whose loaders hand their module back in the call has no
 * in-flight window at all, and a `navigating` that flickered true and false inside one tick would
 * wake every reader of it for a navigation nobody ever waited on.
 */
function loadFor(held: Installed): Promise<void> | null {
    if (held.view.peek() !== null) return null
    // Coalesced, the way a memo slot coalesces identical concurrent reads: `navigate` and `outlet`
    // both ask, and a loader is not required to be a bare `import()` that a module registry would
    // have deduplicated for us.
    if (held.loading !== null) return held.loading
    const parts: (ViewModule | Promise<ViewModule>)[] = []
    let waiting = false
    for (const layout of held.layouts) {
        const module = layout()
        if (isThenable(module)) waiting = true
        parts.push(module)
    }
    const own = held.page()
    if (isThenable(own)) waiting = true
    parts.push(own)
    if (!waiting) {
        adoptModules(held, parts as ViewModule[])
        return null
    }
    const started = Promise.all(parts).then(
        (settled) => {
            held.loading = null
            adoptModules(held, settled)
        },
        (error: unknown) => {
            // Cleared on the way out, so a failed load is retried rather than remembered as an
            // in-flight one nothing will ever settle.
            held.loading = null
            throw error
        },
    )
    held.loading = started
    return started
}

/**
 * The same load as `null` for NOTHING TO WAIT FOR — the form `loadFor` already answers in.
 *
 * Not on `abide` and not re-exported by `$shared/index.ts`: an app writes `await ready()` once, in
 * its client entry, and a nullable promise there would be ceremony for a call that happens on boot.
 * The caller this exists for is the page RENDERER, which asks per request — and after the first view
 * of a route the modules are already resolved, so `ready()`'s `?? SETTLED` is a promise wrap and a
 * microtask tick charged to every page a process serves for nothing.
 */
export function readying(): Promise<void> | null {
    const name = cellsFor().name.peek()
    const held = name === '' ? undefined : BY_NAME.get(name)
    if (held === undefined) return null
    return loadFor(held)
}

/**
 * Load whatever the current route needs, so the render that follows is a snapshot with nothing left
 * to wait for. This is how a server render reaches a page — `renderToString` walks a tree, and a
 * module that has not arrived is not a tree — and it is what `navigate` awaits on the client.
 */
export function ready(): Promise<void> {
    return readying() ?? SETTLED
}

/**
 * The current route's page, wrapped in its layouts. Reactive, and it reads the route's NAME and
 * nothing else — so a navigation WITHIN one route (a different `[id]`, a different query) does not
 * re-run it at all, and the page patches in place instead of being torn down and rebuilt.
 */
export function outlet(): TemplateResult {
    const name = cellsFor().name()
    if (name === '') return NOTHING
    const held = BY_NAME.get(name)
    if (held === undefined) return NOTHING
    // Kicked BEFORE the view is read: a table that hands its modules back in the call resolves here,
    // and the read below then finds it rather than painting nothing and waking a tick later.
    if (held.view.peek() === null) {
        const loading = loadFor(held)
        if (loading !== null) {
            void loading.catch((error: unknown) => {
                queueMicrotask(() => {
                    throw error
                })
            })
        }
    }
    const view = held.view()
    if (view === null) return NOTHING
    let node = view(NO_ARGS)
    for (let i = held.wraps.length - 1; i >= 0; i--) node = (held.wraps[i] as View)({ children: node })
    return node
}

// --- where the caller is ------------------------------------------------------

interface Cells {
    name: State<string>
    params: State<Params>
    url: State<URL>
    navigating: State<boolean>
}

interface Here {
    /**
     * Where this caller is, built on the first READ — so a request that never routes pays for none
     * of this, and the URL lives in the cells rather than beside them where a commit could drift.
     */
    cells: Cells | null
    facade: Route | null
}

// The client's caller — one, forever — and the fallback every unscoped read uses. Doubling as the
// storage key is what `state.shared` does with its map, for the same reason: the fallback and the
// thing it is a fallback FOR should not be two declarations free to drift apart.
const CLIENT: Here = { cells: null, facade: null }
const makeHere = (): Here => ({ cells: null, facade: null })

function hereFor(): Here {
    return storeFor(CLIENT, makeHere, CLIENT)
}

// Installed by `abide/server` on the first `serve`, exactly as the scope source is: a request's URL
// is the honest answer to "where is this caller", and reaching it from here would mean importing the
// server into every browser bundle in order to ask.
let HREF_SOURCE: (() => string | null) | null = null

export function useHrefSource(fn: () => string | null): void {
    HREF_SOURCE = fn
}

/**
 * The document's address bar, from the lane that HAS one. `abide/ui` installs this at import, the
 * same way `abide/server` installs the href source on the first `serve` — so the DOM half of routing
 * lives in the package that owns the DOM, and a server bundle never carries a line of it.
 */
export interface HistorySink {
    /** Where the document is, or null when it is not a PLACE a path could resolve against. */
    href(): string | null
    push(href: string, replace: boolean): void
    /** Back to the top, for a navigation that actually moved. */
    toTop(): void
    /** The user moved through history. The document is ALREADY there, so it is only ours to catch up to. */
    listen(go: (href: string) => void): void
}

let HISTORY_SINK: HistorySink | null = null

export function useHistorySink(sink: HistorySink): void {
    HISTORY_SINK = sink
    // REPLACES rather than pushes, and keeps the scroll: the browser has already moved the URL, and
    // back and forward restore the scroll themselves.
    sink.listen((href) => void navigate(href, { replace: true, keepScroll: true }))
}

function hrefOf(fallback?: string): string {
    const served = HREF_SOURCE === null ? null : HREF_SOURCE()
    if (served !== null) return served
    const shown = HISTORY_SINK === null ? null : HISTORY_SINK.href()
    if (shown !== null) return shown
    if (fallback !== undefined) return fallback
    throw new Error(
        'abide: route() has nothing to answer about — no request is being served and there is no document. Use `serve(request, …)` on a server, or `navigate(…)` first in a script or a test.',
    )
}

function cellsFor(fallback?: string): Cells {
    const here = hereFor()
    if (here.cells !== null) return here.cells
    const url = new URL(hrefOf(fallback))
    const found = lookup(url.pathname)
    const made: Cells = {
        name: state(found === null ? '' : found.held.pattern.path),
        params: state(found === null ? NO_PARAMS : found.params),
        url: state(url),
        navigating: state(false),
    }
    here.cells = made
    return made
}

/** Two params objects a reader cannot tell apart. Flat string maps, so this is the whole of it. */
function sameParams(left: Params, right: Params): boolean {
    if (left === right) return true
    const names = Object.keys(left)
    if (names.length !== Object.keys(right).length) return false
    for (const name of names) if (left[name] !== right[name]) return false
    return true
}

// Write the four cells. Each is identity-deduped by the cell itself, so the only thing this has to
// get right is not handing over a FRESH object for a value that did not change — which is exactly
// what a match produces, and exactly what would wake every reader of it.
//
// The match is handed IN rather than looked up here: `navigate` already resolved this exact pathname
// to decide what to load, and a table walk per navigation is the whole cost of the second lookup.
function commit(cells: Cells, url: URL, found: Match | null): void {
    const heldParams = cells.params.peek()
    if (found === null) {
        cells.name.set('')
        cells.params.set(NO_PARAMS)
    } else {
        cells.name.set(found.held.pattern.path)
        cells.params.set(sameParams(heldParams, found.params) ? heldParams : found.params)
    }
    const before = cells.url.peek()
    cells.url.set(before.href === url.href ? before : url)
}

// A class rather than an object of getter closures: a server builds one of these per request, and
// prototype getters cost one monomorphic object holding one field instead of five function objects
// over a captured environment that then stays alive as long as the facade does.
class RouteFacade implements Route {
    private readonly cells: Cells

    constructor(cells: Cells) {
        this.cells = cells
    }

    get name(): string {
        return this.cells.name()
    }

    // Derived from the name rather than held: "did anything match" is what the name already says,
    // and a second cell would be a second record of one fact for every commit to keep in step.
    get kind(): RouteKind {
        return this.cells.name() === '' ? 'missing' : 'page'
    }

    get params(): Params {
        return this.cells.params()
    }

    get url(): URL {
        return this.cells.url()
    }

    get navigating(): boolean {
        return this.cells.navigating()
    }
}

/**
 * The route being served. Property by property: `route().params.id` subscribes to the parameters
 * alone, and a spinner reading `route().navigating` wakes for nothing else.
 */
export function route(): Route {
    const here = hereFor()
    if (here.facade !== null) return here.facade
    const facade = new RouteFacade(cellsFor())
    here.facade = facade
    return facade
}

// --- building one -------------------------------------------------------------

// Patterns handed to `url` are cached because an href is built per ROW: a list of five hundred links
// through one pattern should parse it once, not five hundred times.
const PARSED = new Map<string, Pattern>()

function patternFor(path: string): Pattern {
    // Only a real PATTERN is cached. An app writes a fixed set of those down; an already-built path
    // — `url('/users/42')` — is not one, and caching those would grow the map by one entry per href
    // for the life of the process. Parsing a path with no placeholder is a split and a push anyway.
    if (path.indexOf('[') === -1) return parsePattern(path)
    let held = PARSED.get(path)
    if (held === undefined) {
        held = BY_NAME.get(path)?.pattern ?? parsePattern(path)
        PARSED.set(path, held)
    }
    return held
}

/**
 * An in-app href: `url('/users/[id]', { id: 42 }, { tab: 'posts' })` → `/users/42?tab=posts`.
 *
 * The first argument is a PATTERN, not an href — the query belongs in the third argument, where it
 * can be encoded. A missing required segment throws, and so does a param the pattern has no segment
 * for: both are typos every time, and both otherwise build an href to the wrong page, which is a bug
 * nothing catches until somebody clicks it.
 */
export function url(path: string, params?: Record<string, unknown>, query?: Record<string, unknown>): string {
    const built = buildPath(patternFor(path), params)
    if (query === undefined) return built
    let search = ''
    for (const name of Object.keys(query)) {
        const value = query[name]
        if (value === undefined || value === null) continue
        const pair = `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`
        search += `${search === '' ? '?' : '&'}${pair}`
    }
    return built + search
}

// --- moving --------------------------------------------------------------------

function land(cells: Cells, url: URL, options: NavigateOptions | undefined, found: Match | null): void {
    const moved = cells.url.peek().pathname !== url.pathname
    // A caller SCOPE is what separates the two worlds: a request being served, or a test driving a
    // route on the side, must not write to an address bar. A browser app has no scope — one caller,
    // forever — and is the only thing that drives the document.
    const sink = currentScope() === null ? HISTORY_SINK : null
    if (sink !== null) {
        sink.push(url.href, options?.replace === true)
        // A same-path navigation is a republish — a tab, a filter, a page number — and scrolling to
        // the top for one of those throws away the reader's place for nothing.
        if (moved && options?.keepScroll !== true) sink.toTop()
    }
    commit(cells, url, found)
}

/**
 * Move to a target — a path, or a whole href. Resolves once the page is on screen.
 *
 * The route is committed only after its modules arrive, so nothing ever renders a page that is not
 * there yet: that is the whole of what `navigating` reports, and a navigation to a route already
 * loaded has no in-flight window and never sets it.
 */
export function navigate(target: string, options?: NavigateOptions): Promise<void> {
    const here = hereFor()
    // A script or a test may navigate before anything has asked where it is, and there may be no
    // document to answer that. The caller is seeded at the target's ROOT rather than at the target
    // itself: a route is committed when its page arrives, and seeding at the target would have the
    // caller already standing on a page that has not loaded. Built only when it is going to be USED —
    // the seed belongs to the first navigation, and every later one would parse it to discard it.
    const cells = here.cells ?? cellsFor(new URL('/', new URL(target, NOWHERE)).href)
    const url = new URL(target, cells.url.peek().href)
    const found = lookup(url.pathname)
    const loading = found === null ? null : loadFor(found.held)
    if (loading === null) {
        land(cells, url, options, found)
        return SETTLED
    }
    cells.navigating.set(true)
    return loading.then(
        () => {
            land(cells, url, options, found)
            cells.navigating.set(false)
        },
        (error: unknown) => {
            cells.navigating.set(false)
            throw error
        },
    )
}
