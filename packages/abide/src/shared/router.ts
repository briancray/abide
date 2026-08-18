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
import { mountBase, mounted, unmounted } from './internal/mount.ts'
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

/**
 * What a page or a layout IS: the same callable a `.abide` file compiles to.
 *
 * `children` and nothing else, because that is the whole of what this calls one with — a page gets
 * none and a layout gets the page it wraps. A compiled component declares its OWN props through
 * `props<T>()`, and one that declared any is not a page: nothing here would have a value to pass.
 */
export type View = (args: { children?: unknown }) => TemplateResult

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
    /**
     * A row nothing routes TO. Absent is a page, which is what a hand-written table means by saying
     * nothing — an `error` row's `path` is the DIRECTORY it covers rather than an address, and
     * `errorFor` is the only thing that reads one.
     *
     * In the same table rather than beside it because both lanes have to carry it: a browser's table
     * is written by a build and a server's by a scan, and an error page in one and not the other is a
     * 404 that renders differently depending on whether the reader arrived by link or by URL bar.
     */
    kind?: 'page' | 'error'
    /**
     * The FILES this entry was read out of, relative to the pages directory. Optional because only a
     * scanner knows them — a table written by hand is loaders and nothing else, and routing itself
     * never reads this.
     *
     * It is here rather than beside the table because there is nowhere else that survives the trip:
     * `pages()` walks a directory and the shell builder wants `modulepreload` links for what a route
     * will import, and a second array zipped to this one by index is a mis-zip away from preloading
     * the wrong page's chunks — silently, since a preload that never matches is only a wasted fetch.
     */
    source?: { page: string; layouts: string[] }
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

/**
 * An `error.abide` and the directory it stands for, as segments — `/docs/[callable]` is
 * `['docs', '[callable]']`.
 *
 * Segments rather than the string, because what is asked of it is a PREFIX and a string prefix is
 * the wrong test: `/doc` prefixes `/docs` and covers none of it. Split once at install, since the
 * alternative is splitting every entry on every failure.
 */
interface ErrorRoute {
    covers: string[]
    held: Installed
}

// Deepest first — see `routes()`. Separate from `TABLE` because nothing may ROUTE to one of these.
let ERRORS: ErrorRoute[] = []

// The entries the current table was installed FROM, so `routes()` can hand them back. The ENTRIES,
// not the `Installed` records built from them: what a borrower gives back has to be something
// `routes` accepts, and an install is a rebuild — a view resolved into one record does not carry
// over into the next.
let ENTRIES: RouteEntry[] = []

const NO_ARGS: { children?: unknown } = Object.freeze({})
const NO_WRAPS: View[] = []
const NO_LAYOUTS: Loader[] = []
// No layouts rendered yet. Shared and empty, so a caller that never renders an outlet allocates none.
const NO_CHAIN: TemplateResult[] = []
// Renders nothing: no route matched, or its module has not arrived. ONE call site, so the identity a
// renderer keys its parsed template on stays stable across every route that has nothing to show.
const NOTHING = html``

/**
 * Install the app's routes, or — with nothing to install — hand back the ones that are installed.
 *
 * Sorted ONCE, by precedence — literal > required > optional > rest — so a match is a walk that stops
 * at the first hit rather than a score kept over every route.
 *
 * The reading form is what makes a table BORROWABLE: a test driving its own routes has to give the
 * app its own back, and there is no other way to ask what they were.
 */
export function routes(): RouteEntry[]
export function routes(table: RouteEntry[]): void
export function routes(table?: RouteEntry[]): RouteEntry[] | undefined {
    if (table === undefined) return ENTRIES
    const installed: Installed[] = []
    const failing: ErrorRoute[] = []
    for (const entry of table) {
        const held: Installed = {
            pattern: parsePattern(entry.path),
            page: entry.page,
            layouts: entry.layouts ?? NO_LAYOUTS,
            view: state<View | null>(null),
            wraps: NO_WRAPS,
            loading: null,
        }
        // An error row is not a route: leaving it out of `TABLE` and `BY_NAME` is the whole of what
        // makes it unaddressable, so there is no path to serve it at and no name to navigate to.
        if (entry.kind === 'error') failing.push({ covers: splitPath(entry.path), held })
        else installed.push(held)
    }
    installed.sort((left, right) => comparePatterns(left.pattern, right.pattern))
    // DEEPEST first, so the walk in `errorFor` stops at the first hit — the same "sorted once, match
    // is a walk that stops" rule the route table above gets, for the same reason.
    failing.sort((left, right) => right.covers.length - left.covers.length)
    ENTRIES = table
    TABLE = installed
    ERRORS = failing
    BY_NAME.clear()
    for (const held of installed) BY_NAME.set(held.pattern.path, held)
    // A table installed after something already asked where it is — a test, or an app declaring its
    // routes late — has to re-answer that question, or the caller keeps the answer it was given by a
    // table that no longer exists.
    const here = hereFor()
    if (here.cells !== null) {
        const url = here.cells.url.peek()
        commit(here.cells, url, lookup(url.pathname))
        // And the new record needs its VIEW kicked, which the commit above cannot do for it: every
        // `Installed` built here starts at `view: null`, and `outlet()` re-runs on the route's NAME —
        // which an install that lands on the same route does not move. So nothing ever asks, the view
        // stays null for the life of the page, and a route with no view is one the client cannot
        // paint: every same-route move went back to the server and rebuilt what it was already
        // holding. Guarded by `here.cells` above, so this asks about a caller that exists rather than
        // constructing one — which is what a `ready()` out here would do, and under a headless runner
        // that means reading an address bar that is `about:blank` on purpose.
        void readying()
    }
}

/**
 * Which route a BROWSER-space pathname names. The mount crossing is here rather than at the three
 * call sites because this is the only thing that reads a pattern against a path: a table is written
 * in app space, an address bar is in browser space, and one of them has to move to meet the other.
 *
 * A path OUTSIDE the mount matches NOTHING, which is a different answer from stripping a base that is
 * not there — that would leave every page served at its mounted address and at the origin root alike,
 * and the root copy would be a page whose own hrefs all point somewhere else.
 */
function lookup(pathname: string): Match | null {
    const base = mountBase()
    if (base !== '' && !pathname.startsWith(base)) return null
    const parts = splitPath(unmounted(pathname))
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
 * Not on `abide.ts` and not on `src/shared/runtime.ts`: an app writes `await ready()` once, in
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
 * The current route's page, wrapped in its layouts. Reactive, and it reads the route's NAME and the
 * adoption counter — not the params and not the url, so a navigation WITHIN one route (a different
 * `[id]`, a different query) that serves no new range does not re-run it, and the page patches in
 * place instead of being torn down and rebuilt.
 */
export function outlet(): TemplateResult {
    return outletFrom(0)
}

/**
 * The same, with the OUTERMOST `from` layouts left off — what a navigation is answered with when the
 * caller is already showing them.
 *
 * Only the server passes anything but 0. A fragment rendered from depth 2 is the tree that belongs
 * inside layout 1's `<slot/>`, and `chain` below is how the client finds the part sitting there.
 */
export function outletFrom(from: number): TemplateResult {
    const cells = cellsFor()
    // Both, and in this order, because they are two different facts: the route changed, or a range
    // arrived for the route already showing. They are written in one commit, so a navigation that
    // moved both still costs this ONE run.
    cells.adopted()
    const name = cells.name()
    // Nothing matched. That is a 404 when the server said so, and this is where its page is drawn —
    // the same `errorOutlet` the server rendered, so the view CLAIMS the range that arrived rather
    // than replacing it. Without this the empty name answers `NOTHING` and wipes it.
    if (name === '') {
        const failure = cells.failure
        if (failure === null) return NOTHING
        const failing = errorFor(cells.url.peek().pathname)
        return failing === null ? NOTHING : errorOutlet(failing, failure)
    }
    const held = BY_NAME.get(name)
    if (held === undefined) return NOTHING
    // Kicked BEFORE the view is read: a table that hands its modules back in the call resolves here,
    // and the read below then finds it rather than painting nothing and waking a tick later.
    const loading = loadFor(held)
    if (loading !== null) {
        void loading.catch((error: unknown) => {
            queueMicrotask(() => {
                throw error
            })
        })
    }
    const view = held.view()
    if (view === null) return NOTHING
    let node = view(NO_ARGS)
    // What each layout was handed as its children, kept so the client can find the PART showing it.
    // A `TemplateResult`'s `values` array is freshly allocated per evaluation, so one of these
    // identifies exactly one slot in exactly one instance — which is what makes the descent in
    // `#ui/internal/navigation.ts` a lookup rather than a guess about which slot a `<slot/>` is.
    //
    // On the cells rather than at module scope, because a server renders two callers at once and this
    // is a fact about ONE of them. Rebuilt per run, never appended to.
    // Its full length up front: the descending fill would otherwise write past the end of an empty
    // array on its first step, which is a holey allocation every `chain[i]` read downstream pays for.
    const chain: TemplateResult[] = new Array(held.wraps.length)
    for (let i = held.wraps.length - 1; i >= from; i--) {
        chain[i] = node
        node = (held.wraps[i] as View)({ children: node })
    }
    cells.chain = chain
    return node
}

/** What each layout of the current render was handed as children. Indexed by DEPTH. */
export function outletChain(): TemplateResult[] {
    return cellsFor().chain
}

// --- the error page ----------------------------------------------------------

/** What an `error.abide` is handed. The status is the whole of what tells a 404 from a 500. */
export interface Failure {
    status: number
    name: string
    message: string
}

/**
 * The failure as a header, and back — the two halves BESIDE each other, because a framing whose ends
 * live in different packages is one they can disagree about. `#server` writes it and `#ui` reads it.
 *
 * URI-encoded because a header is latin-1 and a message is whatever an app threw. The STATUS is not
 * in the text: the response already carries one, so `failureFrom` is handed that instead of a second
 * copy to keep in step.
 */
export function failureHeader(said: Failure): string {
    return encodeURIComponent(JSON.stringify({ name: said.name, message: said.message }))
}

/** `null` for a header this side cannot read — see `failureHeader`. */
export function failureFrom(header: string, status: number): Failure | null {
    let read: { name?: unknown; message?: unknown }
    try {
        read = JSON.parse(decodeURIComponent(header)) as { name?: unknown; message?: unknown }
    } catch {
        return null
    }
    if (typeof read?.name !== 'string' || typeof read?.message !== 'string') return null
    return { status, name: read.name, message: read.message }
}

/**
 * The nearest `error.abide` above `pathname`, or `null` for an app that wrote none.
 *
 * A PREFIX match rather than the whole-path match `lookup` makes, and that is the difference between
 * the two tables: a route answers one address, an error page covers everything under a directory. So
 * `/docs/nonsense` finds `pages/docs/error.abide` even though nothing routes to that path — which is
 * the 404 case, and the one an app most wants its own chrome around.
 *
 * A bracketed directory segment matches any one URL segment, exactly as it does in a route, so an
 * error page inside `[callable]/` covers that route's own failures. A rest segment covers everything
 * from where it stands, so the prefix is satisfied there and the walk stops.
 */
export function errorFor(pathname: string): Installed | null {
    const base = mountBase()
    if (base !== '' && !pathname.startsWith(base)) return null
    const parts = splitPath(unmounted(pathname))
    for (let i = 0; i < ERRORS.length; i++) {
        const entry = ERRORS[i] as ErrorRoute
        if (covers(entry.covers, parts)) return entry.held
    }
    return null
}

function covers(directory: string[], parts: string[]): boolean {
    if (directory.length > parts.length) return false
    for (let i = 0; i < directory.length; i++) {
        const want = directory[i] as string
        if (want.charCodeAt(0) !== OPEN_BRACKET) {
            if (want !== parts[i]) return false
            continue
        }
        // A rest segment swallows what is left, so everything from here on is covered by definition.
        if (want.startsWith('[...')) return true
    }
    return true
}

const OPEN_BRACKET = 91

/** The error page's module, and its layouts'. `null` when there is nothing left to load. */
export function errorReady(held: Installed): Promise<void> | null {
    return loadFor(held)
}

/**
 * An error page wrapped in the layouts above it — what a failure renders as when the app wrote one.
 *
 * `outletFrom`'s shape with two differences, and both are the same fact: this render is TERMINAL. It
 * takes its entry rather than reading the route, because the route is what failed or never matched;
 * and it writes no `cells.chain`, because that record exists so a later navigation can patch INTO a
 * layout, and there is no fragment depth to answer for a page nothing navigated to.
 */
export function errorOutlet(held: Installed, failure: Failure): TemplateResult {
    const view = held.view.peek()
    if (view === null) return NOTHING
    let node = view(failure as never)
    for (let i = held.wraps.length - 1; i >= 0; i--) {
        node = (held.wraps[i] as View)({ children: node })
    }
    return node
}

/**
 * The route whose layouts this caller can put a fragment INSIDE, without subscribing to it.
 *
 * The pattern it is standing on, and `''` — claim nothing — while a served range is standing that no
 * commit has claimed. That range replaced the layouts the committed name describes, so naming it
 * would have the server leave off chrome the reader is no longer looking at, and the descent through
 * `outletChain` would then be looking for parts that were disposed when the range was reclaimed. The
 * server reads `''` as a caller that cannot place a fragment and answers with the whole outlet, which
 * is the one arrangement that is right however deep the two routes happen to agree.
 */
export function placeableRouteName(): string {
    const cells = cellsFor()
    return cells.stood ? '' : cells.name.peek()
}

/**
 * How many of the TARGET route's layouts a caller on `fromName` is already showing.
 *
 * Compared by LOADER identity rather than by path, because that is what decides whether the module on
 * screen is the module the target would use — two routes naming the same layout file resolve to one
 * thunk, and two thunks that merely look alike are two different layouts.
 *
 * The prefix stops at the first difference and never resumes: layouts nest, so a shared layout below
 * a changed one is inside a subtree that is being replaced anyway.
 */
export function sharedLayoutDepth(fromName: string): number {
    const target = BY_NAME.get(cellsFor().name.peek())
    const from = BY_NAME.get(fromName)
    if (target === undefined || from === undefined) return 0
    const wanted = target.layouts
    const held = from.layouts
    const limit = wanted.length < held.length ? wanted.length : held.length
    let shared = 0
    while (shared < limit && wanted[shared] === held[shared]) shared++
    return shared
}

// --- where the caller is ------------------------------------------------------

interface Cells {
    name: State<string>
    params: State<Params>
    url: State<URL>
    navigating: State<boolean>
    /**
     * How many ranges the outlet has been handed off the wire. Read for its EDGE, never its value.
     *
     * A served navigation fills the outlet's range from the server and then needs the view to CLAIM
     * it — and the route it lands on may be the one already showing, a different `[id]` under the
     * same pattern. The name would not move for that, so the streamed nodes would sit on screen with
     * nothing claiming them and no reactivity in them. This is the write that says "a new range is
     * standing there", which is a different fact from "the route changed".
     */
    adopted: State<number>
    /**
     * What each layout of the last `outletFrom` run was handed as its children, indexed by depth.
     *
     * Not a cell and never read to render — it is a lookup key, handed to `#ui` so a served fragment
     * can be put inside the layout it belongs in rather than over the whole outlet.
     */
    chain: TemplateResult[]
    /**
     * Which served navigation is the LIVE one. A plain counter, not a cell: nothing reads it to
     * render, it is read back across the awaits in `enter` to ask "am I still the newest?".
     *
     * A navigation resolves when its whole range has landed, and a reader can start another one
     * before that — so without this the overtaken call still ran `commit` when its stream finally
     * ended, leaving the reader on the new page showing the old page's params.
     *
     * Claimed by EVERY navigation and not only by the served ones. A local move is instant, which is
     * exactly why it has to take one: it lands while a served answer is still on the wire, and the
     * served call then committed over the top of it — the reader clicked a link, saw that page, and
     * was moved back off it a second later by the navigation they had already left.
     */
    entering: number
    /**
     * A served range is standing in the outlet that no commit has claimed yet.
     *
     * TRUE from the first piece landing until the route it belongs to is committed, and it is the one
     * thing that makes the committed route a LIE about the screen: `name` still says where the reader
     * was, while the range that page rendered into has already been torn down and refilled from the
     * wire. Both of the questions a navigation asks about the screen — may I patch in place, and
     * which layouts am I already showing — are answered off `name`, so both are wrong exactly here.
     *
     * Owned by the LIVE navigation, which is what decides where it is cleared: beside the commit on
     * the way through, and again in `enter`'s `finally` so no other exit can leave it set. An
     * overtaken navigation leaves it alone — the one that overtook it owns the range by then.
     *
     * Not a cell: nothing renders from it, and the two readers are decisions taken inside `navigate`.
     */
    stood: boolean
    /**
     * The failure the range now standing in the outlet was rendered from, or `null` for every
     * ordinary page.
     *
     * Not a cell, and it does not need to be: the write that puts one here is the same commit that
     * moves `name` to `''` and bumps `adopted`, and `outletFrom` reads both. So the wake is already
     * paid for, and a cell would be a second record of one fact for every commit to keep in step.
     *
     * It is what stops a served 404 from blanking: without it `outletFrom` reads an empty name,
     * answers `NOTHING`, and wipes the range the server just filled — the error page appears and is
     * gone one microtask later.
     */
    failure: Failure | null
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

/**
 * What one entry left behind — the two facts the caller cannot see for itself.
 *
 * `complete` is the rest of the answer, after the piece that resolved `enter`. It is a promise rather
 * than a callback because the route is committed against it: the range is whole only when it settles.
 */
export interface Entered {
    /** The browser is taking this URL. Nothing may be committed against a document that is going. */
    left: boolean
    /** Every piece after the first, applied. Never settles for a navigation that left. */
    complete: Promise<void>
    /**
     * The answer was an `error.abide` render, and this is what it was rendered FROM.
     *
     * Absent for every ordinary navigation. It travels back through the sink rather than being read
     * off the route, because nothing MATCHED — the server is the only side that knows a path it does
     * not serve failed rather than simply not existing, and which of its error pages answered.
     */
    failure?: Failure | null
}

/**
 * How a lane with a DOCUMENT moves between routes: it asks the SERVER for the page and puts the
 * answer on the screen as it arrives. `abide/ui` installs this from the part that is showing the
 * outlet, which is the only part a navigation repaints.
 *
 * The policy stays here and the fetching stays there, the same seam `HistorySink` draws: what a
 * navigation IS — when the server is worth asking, and when the answer is allowed to become the
 * route — is routing's, and it must not need a document to be decided.
 */
export interface NavigationSink {
    /**
     * Resolves when the FIRST piece is on screen, not when the page is whole.
     *
     * `live` is what says this navigation is still the one the reader is waiting on, and it is asked
     * at the MUTATION rather than around the call: `enter` below re-checks after this resolves, but
     * the range has already been replaced by then, so a click landing while the answer was in flight
     * had its page painted over by the one it overtook. A sink that stands a fragment without asking
     * is that bug, and it is silent — the markup it paints is correct markup for the wrong page.
     */
    enter(url: URL, live: () => boolean): Promise<Entered>
}

let NAVIGATION_SINK: NavigationSink | null = null

/**
 * Returns the way OUT, the way `joinTags` does. A renderer that installed this and was then torn
 * down leaves the router driving a part whose anchor is no longer in the document — every later
 * navigation moves the address bar, resolves, and paints nothing.
 *
 * Only the sink that is still installed may clear the slot: a second mount replacing the first must
 * not be uninstalled by the first one's teardown arriving afterwards.
 */
export function useNavigationSink(sink: NavigationSink): () => void {
    NAVIGATION_SINK = sink
    return () => {
        if (NAVIGATION_SINK === sink) NAVIGATION_SINK = null
    }
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
        adopted: state(0),
        failure: null,
        chain: NO_CHAIN,
        entering: 0,
        stood: false,
    }
    here.cells = made
    return made
}

/**
 * Two params objects a reader cannot tell apart. Flat string maps, so this is the whole of it.
 *
 * `for…in` rather than `Object.keys`, for the reason `buildPath` and `url` both give below: this runs
 * per navigation and again on every `routes()` re-install, and the two keys arrays would be garbage
 * every time. A name `right` lacks reads `undefined` against a string, so the value test alone puts
 * `left`'s names inside `right`'s and the counts settle the rest.
 */
function sameParams(left: Params, right: Params): boolean {
    if (left === right) return true
    let mine = 0
    for (const name in left) {
        if (left[name] !== right[name]) return false
        mine++
    }
    let theirs = 0
    for (const _name in right) theirs++
    return mine === theirs
}

// Write the three cells a match decides — name, params and url. `navigating` and `adopted` are the
// other two, and they are written by the callers that know about a navigation rather than here.
// Each is identity-deduped by the cell itself, so the only thing this has to
// get right is not handing over a FRESH object for a value that did not change — which is exactly
// what a match produces, and exactly what would wake every reader of it.
//
// The match is handed IN rather than looked up here: `navigate` already resolved this exact pathname
// to decide what to load, and a table walk per navigation is the whole cost of the second lookup.
function commit(cells: Cells, url: URL, found: Match | null, failure: Failure | null = null): void {
    // Written on EVERY commit, including the ordinary ones that pass nothing — a failure left behind
    // by the page a reader has already navigated away from is a 404 rendered over a route that
    // matched perfectly well.
    cells.failure = found === null ? failure : null
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

/**
 * Is this path already exactly what `buildPath` would produce for it?
 *
 * True only when there is nothing left to decide: rooted, no trailing or doubled slash, no
 * placeholder, and every character one `encodeURIComponent` leaves alone. Anything else takes the
 * long way, because the long way is where the meaning is — a space becomes `%20`, an existing `%20`
 * becomes `%2520`, a trailing slash is dropped, and a `[` opens a segment. Getting that wrong would
 * build an href to the wrong page, which is the failure `url` exists to prevent.
 *
 * The scan is per character of the PATH, not per row: a href is a handful of characters, and it
 * replaces a split, an array of segments and a rebuild.
 */
function literalPath(path: string): boolean {
    if (path.charCodeAt(0) !== 47 /* / */) return false
    if (path.length > 1 && path.charCodeAt(path.length - 1) === 47) return false
    for (let i = 0; i < path.length; i++) {
        const code = path.charCodeAt(i)
        if (code === 47) {
            if (path.charCodeAt(i + 1) === 47) return false
            continue
        }
        // Unreserved, per RFC 3986: these are the characters `encodeURIComponent` hands back
        // untouched, so a segment made only of them rebuilds to itself.
        const unreserved =
            (code >= 97 && code <= 122) ||
            (code >= 65 && code <= 90) ||
            (code >= 48 && code <= 57) ||
            code === 45 ||
            code === 46 ||
            code === 95 ||
            code === 126
        if (!unreserved) return false
    }
    return true
}

/** Only a real PATTERN is cached — see `pathFor`, its only caller, which does the dispatch. */
function heldPattern(path: string): Pattern {
    let held = PARSED.get(path)
    if (held === undefined) {
        held = BY_NAME.get(path)?.pattern ?? parsePattern(path)
        PARSED.set(path, held)
    }
    return held
}

/**
 * The pattern half, on a path that is already known to be one.
 *
 * The placeholder probe is the DISPATCH rather than a pre-check, and that is what keeps the two arms
 * from taxing each other: a path with a `[` goes straight to its cached pattern and never touches the
 * scan below, which was otherwise 65% on `url('/a/[[b]]')`. Only a real pattern is cached — caching
 * built hrefs would grow the map by one entry per href for the process's life.
 *
 * And a path that is already the answer IS the answer. `url('/about')` is the commonest shape a nav
 * has, and it was paying a split, a segment array and a rebuild to arrive back at the string it
 * started with — per row. Only with no params to place, because a param against a placeholder-free
 * pattern is a typo the long way is there to report.
 */
function pathFor(path: string, params: Record<string, unknown> | undefined): string {
    if (path.indexOf('[') !== -1) return buildPath(heldPattern(path), params)
    if (params === undefined && literalPath(path)) return path
    return buildPath(parsePattern(path), params)
}

/**
 * The ORIGIN a target names, or `''` when it names none — `https://host`, `//host`, and the whole of
 * an opaque `mailto:…`.
 *
 * Split by SCANNING rather than by handing the string to `new URL`, and that is not a preference: the
 * other half is still a PATTERN with its `[id]` in it, and a URL parser percent-encodes the brackets.
 * `/users/%5Bid%5D` is a path no pattern matches and no route serves.
 */
function originOf(target: string): string {
    if (target.charCodeAt(0) === 47 /* / */) {
        // `//host` is protocol-relative and names an origin; one slash is an ordinary path.
        if (target.charCodeAt(1) !== 47) return ''
        const end = target.indexOf('/', 2)
        return end === -1 ? target : target.slice(0, end)
    }
    const colon = target.indexOf(':')
    if (colon === -1) return ''
    // A `:` inside a later segment — `notes/a:b` — is a path, not a scheme.
    const slash = target.indexOf('/')
    if (slash !== -1 && slash < colon) return ''
    if (target.charCodeAt(colon + 1) !== 47 || target.charCodeAt(colon + 2) !== 47) return target
    const end = target.indexOf('/', colon + 3)
    return end === -1 ? target : target.slice(0, end)
}

/** Where the caller IS, for the two shapes that are resolved against it. `NOWHERE` when nothing knows. */
function hereHref(): string {
    const here = hereFor()
    // A REACTIVE read, not a peek: a relative href is a fact about the current URL, so one built into
    // a template has to move when the route does. Only these two shapes pay it — the root-absolute
    // pattern every app writes never reaches here.
    return here.cells === null ? hrefOf(NOWHERE) : here.cells.url().href
}

/**
 * Everything `navigate` accepts that is not a root-absolute pattern: an absolute URL, a
 * protocol-relative one, and a path relative to where the caller is.
 *
 * Kept out of `url` proper so the shape an app actually writes stays one `charCodeAt` away from its
 * fast path — an href is built per row, and none of the work here belongs to that row.
 */
function elsewhere(path: string, params: Record<string, unknown> | undefined): string {
    const origin = originOf(path)
    // An opaque target, or an origin with nothing after it. There is no path to build.
    if (path !== '' && origin === path) return path
    if (origin !== '') {
        const [ahead, tail] = beforeQuery(path.slice(origin.length))
        const built = pathFor(ahead, params)
        // The mount belongs to THIS app, so it goes on only when the target IS this app — the same
        // test `navigate` makes, and for the same reason.
        const here = new URL(hereHref()).origin
        return origin + (origin === here ? mounted(unmounted(built)) : built) + tail
    }
    // Relative. BUILT before it is resolved, for `originOf`'s reason: `new URL` would encode the
    // brackets. `buildPath` roots what it hands back and takes an unrooted pattern as written, so the
    // slice is the only adjustment — and a refusal then names `users/[id]` rather than a `/users/[id]`
    // the author did not write.
    const [ahead, tail] = beforeQuery(path)
    const at = new URL(pathFor(ahead, params).slice(1) + tail, hereHref())
    return mounted(unmounted(at.pathname)) + at.search + at.hash
}

/** A target split at its query or hash — the pattern is the part in front, and the rest is carried. */
function beforeQuery(target: string): [string, string] {
    let cut = target.length
    for (let i = 0; i < target.length; i++) {
        const code = target.charCodeAt(i)
        if (code === 63 /* ? */ || code === 35 /* # */) {
            cut = i
            break
        }
    }
    return cut === target.length ? [target, ''] : [target.slice(0, cut), target.slice(cut)]
}

/**
 * An in-app href: `url('/users/[id]', { id: 42 }, { tab: 'posts' })` → `/users/42?tab=posts`.
 *
 * The first argument is a PATTERN, and it accepts every shape `navigate` does — a root-absolute
 * pattern, a relative one resolved against where the caller is, an absolute URL, and a
 * protocol-relative one. The two agree by construction, so `navigate(url(…))` and `navigate(…)` are
 * the same move. The query still belongs in the third argument, where it can be encoded.
 *
 * A missing required segment throws, and so does a param the pattern has no segment for: both are
 * typos every time, and both otherwise build an href to the wrong page, which is a bug nothing catches
 * until somebody clicks it.
 *
 * What comes back is in BROWSER space: under a mount it carries the base, because an `href` is what a
 * browser resolves against the ORIGIN rather than against the app. This is the only thing that mints
 * one, and that is what makes a mount a deploy-time value — an app that builds its hrefs here moves
 * under a sub-path with no source change, and one writing `href="/users/42"` by hand has opted out.
 * A target on ANOTHER origin carries no base: this app's mount is not a fact about somebody else's.
 */
export function url(path: string, params?: Record<string, unknown>, query?: Record<string, unknown>): string {
    // One compare picks the shape every app writes — a root-absolute pattern, which is also the only
    // one that resolves against nothing and so needs no caller. `//` is NOT it: it names a host, the
    // way it does everywhere else a URL is written, and `elsewhere` hands it back untouched.
    const built =
        path.charCodeAt(0) === 47 && path.charCodeAt(1) !== 47
            ? mounted(pathFor(path, params))
            : elsewhere(path, params)
    if (query === undefined) return built
    let search = ''
    // `for…in` rather than `Object.keys`, for the reason `buildPath` gives: an href is built per row,
    // and the keys array would be garbage every time.
    for (const name in query) {
        const value = query[name]
        if (value === undefined || value === null) continue
        const pair = `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`
        search += `${search === '' ? '?' : '&'}${pair}`
    }
    // Appended with the separator the target already has: an absolute URL may have brought its own
    // query, and a second `?` is a query string nothing parses.
    return built + (search === '' ? '' : built.indexOf('?') === -1 ? search : `&${search.slice(1)}`)
}

// --- moving --------------------------------------------------------------------

/**
 * Whether this caller is the one that owns the page.
 *
 * A caller SCOPE is what separates the two worlds: a request being served, or a test driving a route
 * on the side, must not write to an address bar or ask the server for a page. A browser app has no
 * scope — one caller, forever — and is the only thing that drives the document. Named rather than
 * spelled twice, so a third document-driving sink copies the RULE and not the expression.
 */
function drivesDocument(): boolean {
    return currentScope() === null
}

/**
 * The address bar's half of landing, on its own because a served navigation does the two halves at
 * different moments: the URL moves when the first piece is on screen, and the route is committed when
 * the range behind it is whole.
 */
function place(cells: Cells, url: URL, options: NavigateOptions | undefined): void {
    const moved = cells.url.peek().pathname !== url.pathname
    const sink = drivesDocument() ? HISTORY_SINK : null
    if (sink === null) return
    sink.push(url.href, options?.replace === true)
    // A same-path navigation is a republish — a tab, a filter, a page number — and scrolling to the
    // top for one of those throws away the reader's place for nothing.
    if (moved && options?.keepScroll !== true) sink.toTop()
}

function land(cells: Cells, url: URL, options: NavigateOptions | undefined, found: Match | null): void {
    place(cells, url, options)
    commit(cells, url, found)
}

/**
 * Whether this move is one the client can already paint, so the round trip buys nothing.
 *
 * The route ALREADY SHOWING, with its module resolved: the page is on screen, the params are cells,
 * and the render that follows therefore PATCHES. `outlet` reads the name and not the params, so it
 * does not even re-run — the page's own reads move and its nodes keep their identity, which is the
 * whole point. A carousel keeps its scroll offset, an open `<details>` stays open, and focus stays
 * where the reader put it.
 *
 * The served path can do none of that however identical the markup it returns, because it refills the
 * outlet's whole range from the wire and a refill is a rebuild. Measured on this repo's own suite
 * page: a query-only move replaced all 28 `<details>` on it, none still open.
 *
 * This is NOT a second rendering path — it is the local one every server render and every headless
 * case already runs on, reached by a condition rather than by a second implementation.
 *
 * The TRADE, stated because it is real: this move does not run the app's middleware onion, so a
 * redirect a rung would have issued for the new params does not fire. It is not an authorization
 * hole — every `rpc` is still answered by the server, and a client cannot render data it was never
 * given — but a login redirect on a same-route move reaches the reader as failed calls instead.
 * Crossing to another route is unchanged and still goes through the onion.
 */
function paintsLocally(cells: Cells, found: Match | null): boolean {
    if (found === null) return false
    // A served range is standing that nothing has committed, so the route below names a page whose
    // nodes are gone — reclaimed when that range was filled. "The page is on screen and the render
    // that follows therefore patches" is the whole premise of this path, and it is false here: the
    // params would move, the page's own reads would wake, and they would patch nothing at all.
    if (cells.stood) return false
    if (found.held.pattern.path !== cells.name.peek()) return false
    // A route can be the one showing and still have nothing to render with — an async loader whose
    // first module has not landed. Then the server is the faster answer as well as the only one.
    //
    // The other way to reach it is not obvious and cost an afternoon to find: `routes(table)` REBUILDS
    // every record, so a caller that borrows the table and gives it back resets every resolved view.
    // Nothing then asks for it again — `outlet` reads the route's NAME, which a restore does not move,
    // so it never re-runs and never kicks the load — and the view stays null for the life of the page.
    // A borrower's answer is to `ready()` after restoring, which is one line where it belongs; two
    // attempts to carry views across the install instead were dropped, both because the borrow has
    // already replaced what they compare against by the time the restore runs.
    return found.held.view.peek() !== null
}

/**
 * A navigation the SERVER answers: the page arrives as markup, and the client's copy of its module is
 * what CLAIMS that markup rather than what draws it.
 *
 * The two are asked for together, and the route is committed only when both have landed. That
 * ordering is the whole of this function. The commit is what wakes `outlet`, and an outlet woken
 * while the range is still being filled would build over it — `reclaiming` snapshots what to adopt at
 * `done`, and not before, because a patch replacing a top-level placeholder rewrites the very list
 * that snapshot holds. So a page with a slow suspended panel is VISIBLE from its first piece and
 * interactive when the last one lands, which is the trade this makes on purpose: the module is what
 * makes a page interactive, not what makes it appear.
 */
async function enter(
    cells: Cells,
    url: URL,
    options: NavigateOptions | undefined,
    found: Match | null,
    sink: NavigationSink,
    mine: number,
): Promise<void> {
    const loading = found === null ? null : loadFor(found.held)
    // Claimed by `navigate` before this was called. Every step below that could have been overtaken
    // asks whether this is still the newest navigation, because a reader who clicked twice is waiting
    // on the second answer and this one has nothing left to say. The abandoned response is still read
    // to its end — the part's reclaim handle is superseded, so what it reads paints nothing — rather
    // than cancelled, which would need a way to say so through the sink.
    //
    // Handed to the sink as well, because the checks here are all AFTER an await and the sink writes
    // to the document inside one: by the time the check below runs, an overtaken answer has already
    // stood its page over the one the reader chose.
    const live = (): boolean => cells.entering === mine
    cells.navigating.set(true)
    try {
        const entered = await sink.enter(url, live)
        // The browser is taking this URL and its own load answers everything below, so this side
        // commits NOTHING — not the address it answers about, not the route, not the range. Resolving
        // rather than waiting on `complete`, which is a promise nothing settles: the caller asked to
        // move and the move is happening, just not here.
        if (entered.left) return
        if (cells.entering !== mine) return
        // The first piece is on screen, so the address bar is now behind what the reader is looking
        // at. This is the half that cannot wait for the range to be whole — and the range standing
        // there is now what the screen IS, which is what the committed route has stopped describing.
        cells.stood = true
        place(cells, url, options)
        await entered.complete
        if (loading !== null) await loading
        // The ERROR page's own module, and it has to be awaited here for the same reason `loading`
        // above is: a view that has not arrived is not a tree. `found` is null for a 404, so the load
        // kicked at the top of this function was never started — and committing without it left
        // `errorOutlet` reading a null view, answering `NOTHING`, and wiping the range the server had
        // just filled. The tell was a hydration mismatch naming a leftover `<header>`: the layouts had
        // arrived in the fragment and this side had nothing to claim them with.
        const failure = entered.failure ?? null
        if (failure !== null) {
            const failing = errorFor(url.pathname)
            const failingLoad = failing === null ? null : errorReady(failing)
            if (failingLoad !== null) await failingLoad
        }
        if (cells.entering !== mine) return
        // The sink's own answer about what it stood there, which for a served `error.abide` is the
        // only route the failure has: nothing MATCHED, so `found` is null either way and the null
        // cannot tell a 404 the server rendered from a path this table simply has no row for.
        commit(cells, url, found, failure)
        // In the same synchronous region as the commit, so the renderer takes both in ONE flush and
        // the page's view runs once for the navigation however many cells moved.
        cells.adopted.set(cells.adopted.peek() + 1)
    } finally {
        // Only the live navigation may say either of these is over: an overtaken one finishing its
        // stream would otherwise clear them while the newer one is still in flight.
        //
        // `stood` is cleared HERE and nowhere else, which is what makes the commit and the clear one
        // fact rather than two: nothing between the commit above and this reads it — the renderer
        // batches onto a microtask and there is no await in that region — and a clear beside the
        // commit would leave the flag set on a throw between standing the range and committing it,
        // with `paintsLocally` then refusing the next same-route move its local patch. That heals
        // itself, because the refusal forces the next move down this path and it clears the flag on
        // its way through, so the cost is one round trip rather than a page stuck on the server. An
        // OVERTAKEN navigation deliberately leaves it set: the one that overtook it owns the range
        // now, and clears it on its own commit.
        if (cells.entering === mine) {
            cells.stood = false
            cells.navigating.set(false)
        }
    }
}

/**
 * A target as the browser has to ask for it, whichever space the caller wrote it in.
 *
 * `navigate('/users/42')` is APP space — the same space the route table and every `href` in the source
 * is written in — and `navigate(url('/users/[id]', …))` is BROWSER space, because `url` already
 * crossed. Both are ordinary spellings and both arrive here, so the crossing is IDEMPOTENT: take off
 * a base that is there, put on the one that should be. That is what lets a mount be a deploy-time
 * value — every `navigate` in an app keeps working when `APP_URL` gains a path.
 *
 * The one thing it cannot tell apart is an app whose own route starts with the base's first segment:
 * mounted at `/v2`, `navigate('/v2/x')` moves to the app's `/x`, never to its `/v2/x`. Naming a route
 * after the mount is the fix, and it is a fix in the app rather than a case here.
 *
 * A target on another ORIGIN is left alone — nothing about this app's mount applies to it, and the
 * fetch that follows lands somewhere `unmounted` has no claim on.
 */
function mountedTarget(at: URL, from: URL): URL {
    if (mountBase() === '' || at.origin !== from.origin) return at
    const path = mounted(unmounted(at.pathname))
    if (path === at.pathname) return at
    const moved = new URL(at.href)
    moved.pathname = path
    return moved
}

/**
 * Move to a target — a path, or a whole href. Resolves once the page is on screen.
 *
 * The route is committed only after its modules arrive, so nothing ever renders a page that is not
 * there yet: that is the whole of what `navigating` reports, and a navigation to a route already
 * loaded has no in-flight window and never sets it.
 *
 * Where there is a document, the page is the SERVER's to render and this waits on that — see `enter`.
 */
export function navigate(target: string, options?: NavigateOptions): Promise<void> {
    const here = hereFor()
    // A script or a test may navigate before anything has asked where it is, and there may be no
    // document to answer that. The caller is seeded at the target's ROOT rather than at the target
    // itself: a route is committed when its page arrives, and seeding at the target would have the
    // caller already standing on a page that has not loaded. Built only when it is going to be USED —
    // the seed belongs to the first navigation, and every later one would parse it to discard it.
    const cells = here.cells ?? cellsFor(new URL('/', new URL(target, NOWHERE)).href)
    const url = mountedTarget(new URL(target, cells.url.peek().href), cells.url.peek())
    const found = lookup(url.pathname)

    // Claimed HERE rather than inside `enter`, so the local arm takes one too. A local move is the
    // arm that most needs it: it lands in the same tick, so it is the one a reader reaches for while
    // a served answer is still on the wire, and that answer then committed on top of it.
    const mine = ++cells.entering

    // Where there is a document showing the outlet, a navigation the client cannot already paint is
    // the SERVER's to answer: the page is rendered by the app's own middleware onion once, at the URL
    // being asked for, and this side claims what comes back.
    //
    // A request being served and a test driving a route on the side each render locally.
    const sink = drivesDocument() && !paintsLocally(cells, found) ? NAVIGATION_SINK : null
    if (sink !== null) return enter(cells, url, options, found, sink, mine)

    const loading = found === null ? null : loadFor(found.held)
    // Nothing to wait for, so nothing can overtake it between the claim above and the landing: the
    // check the other arm makes would be reading a counter that has not been touched since.
    if (loading === null) {
        land(cells, url, options, found)
        return SETTLED
    }
    cells.navigating.set(true)
    return loading.then(
        () => {
            // Overtaken while its module was arriving. Landing anyway would move the address bar back
            // to a page the reader has already left, which is the served arm's bug in the other lane.
            if (cells.entering !== mine) return
            land(cells, url, options, found)
            cells.navigating.set(false)
        },
        (error: unknown) => {
            if (cells.entering === mine) cells.navigating.set(false)
            throw error
        },
    )
}
