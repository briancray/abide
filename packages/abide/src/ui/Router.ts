import { CURRENT_ROUTER, type NavigateOptions } from '#shared/CURRENT_ROUTER.ts'
import { firstMatch, type Params } from '#shared/matchRoute.ts'
import {
    parseRoutePattern,
    rankBySpecificity,
    type Segment,
} from '#shared/routePattern.ts'
import { applyHead } from './applyHead.ts'
import { LAYER_MOUNT, LAYER_NAVIGATE } from './LAYER_NAMES.ts'
import { beginLayer, endLayer } from './measureLayer.ts'
import { REGION_CLOSE, REGION_OPEN } from './REGION.ts'
import { fillRegion, type Region } from './regions.ts'
import type { Scope } from './Scope.ts'

// A PAGE'S CLIENT MODULE, mounted against the region the router owns. The same default export a
// page already has — the router is a CALLER of a page exactly as a page is a caller of a
// component, which is why nothing about the emitted module changes to be routable.
export type PageMount = (root: Region, props?: Record<string, unknown>) => Scope

// `head` is emitted only where a page carries its own markup, which is every routable one — but
// a page with no `<head>` block contributes nothing and ships no such export, so it is optional
// here rather than a function that returns ''.
type PageModule = { default: PageMount; head?: () => string }

export type Route = {
    // The route literal, in the bracket spelling the page's directory is already written in.
    pattern: string
    load: () => Promise<PageModule>
    // 35.1 — the layouts this page renders inside, outermost first, as the build found them.
    // REQUIRED, as it is on the server's own row (`ServerRoute`): `tableOf` writes the key into
    // both tables unconditionally, so an optional one was a second record shape for a row every
    // navigation reads and a `??` arm the emitted table could not reach.
    layouts: (() => Promise<PageModule>)[]
}

type Compiled = Route & { segments: Segment[] }

// 41.11 — ONE LEVEL OF WHAT IS MOUNTED: the module standing there, the scope that stops it, and
// the region its child occupies. The router holds these rather than letting each level own the
// one below it, which is what makes a shared layout something it can KEEP: a scope stopped from
// above takes its children with it, and a layout that survives a navigation must not take the
// page it was holding a moment ago.
type Level = {
    module: PageModule
    scope: Scope | undefined
    // Where this level's `<slot/>` is, learned when the level below it mounted there.
    slot: Region | undefined
}

// WHAT THE ROUTER PUT ON THE PAGE, so a navigation can take it back off. A page mounted into the
// region owns a `Scope` (12.13) and the router is the only thing that can remove its nodes, so the
// router is where that scope is stopped.
export class Router {
    region: Region
    routes: Compiled[]
    // The chain standing in the document, outermost layout first and the page last.
    levels: Level[]
    // WHICH NAVIGATION IS THE LIVE ONE. Both ways in await the destination's module before they
    // touch anything, and a dynamic import resolves in whatever order the chunks arrive — so two
    // clicks, or a click landing while `hydrate` is still loading, each mounted a page: the second
    // one to finish overwrote `this.scope` and the first page's bindings were left awake, writing
    // into nodes the other page had replaced. Nothing about the screen showed it — the newest
    // markup was on top — which is why it is a counter rather than a flag.
    //
    // TAKEN BEFORE THE AWAIT AND CHECKED AFTER IT, so a superseded navigation stops before it
    // stops a scope, empties the region or pushes a history entry for a page nobody will see.
    navigation: number
    // The routes whose chunks `prefetch` has already asked for. `pointerover` bubbles, so a
    // pointer crossing a link's children asks again at every edge, and after the first time the
    // answer is the module cache's anyway.
    prefetched: Set<Compiled>

    constructor(region: Region, routes: Compiled[]) {
        this.region = region
        this.routes = routes
        this.levels = []
        this.navigation = 0
        this.prefetched = new Set()
    }

    // THE PAGE'S SCOPE, for a caller that reads it — the chain's is `levels`. DERIVED rather than
    // held: it was a field assigned on the way down `mountFrom` and never cleared by `stopFrom`, so
    // between a navigation stopping the chain and the next one mounting it named a scope that had
    // already been stopped. One fact, read off the array that owns it (41.11).
    get scope(): Scope | undefined {
        return this.levels[this.levels.length - 1]?.scope
    }

    match(pathname: string): { route: Compiled; params: Params } | undefined {
        return firstMatch(this.routes, pathname)
    }

    // 30.14 — A NAVIGATION THE READER HAS SIGNALLED, LOADED BEFORE IT HAPPENS: the route's chunks are
    // asked for on intent, so the click finds them in the module cache and setup — and with it
    // every call the page makes — starts at once. Only the CODE: a call run on a hover would be a
    // call nobody asked for, and for anything but a `GET` one with an effect. A failed load is
    // left for the click, which reports it, and the next intent asks again.
    prefetch(pathname: string): void {
        const route = this.match(pathname)?.route
        if (route === undefined || this.prefetched.has(route)) return
        this.prefetched.add(route)
        load(route).catch(() => this.prefetched.delete(route))
    }

    // 30.7 — NAVIGATES, AND DOES NOT RELOAD. Everything between the anchors is replaced and the
    // document, its history entry and every module already loaded stay exactly where they are.
    //
    // THE MARKUP COMES FROM THE PAGE'S OWN MODULE. A page the server painted arrives with its
    // markup between the anchors and hydrates; a page navigated TO arrives as the empty pair and
    // fills itself from the template it carries. One module, both ways in — the `isEmptyRegion`
    // guard the emitter already writes is the whole of the difference.
    async go(url: URL | string, options: NavigateOptions = {}): Promise<void> {
        const target =
            typeof url === 'string' ? new URL(url, location.href) : url
        // A CROSS-ORIGIN ADDRESS IS NOT A ROUTE. Handing it to `pushState` throws, and treating
        // it as a miss would leave the caller with a navigation that silently did nothing.
        if (target.origin !== location.origin) {
            location.href = target.href
            return
        }
        const found = this.match(target.pathname)
        if (found === undefined) {
            // NOT A ROUTE THIS BUILD KNOWS, so it is the server's to answer — which is a document
            // load, and the one case where 30.7 does not apply because there is no route to run.
            location.href = target.href
            return
        }
        this.navigation += 1
        const ticket = this.navigation
        const arriving = await load(found.route)
        // SUPERSEDED, so this navigation is over. Nothing has been touched yet, which is the whole
        // reason the ticket is checked here rather than after the mount.
        if (this.navigation !== ticket) return

        // OPENED WHERE THE NAVIGATION COMMITS, which is after the last early exit and after the
        // `await` above. The awaited load is a NETWORK wait, and a layer that contained it would
        // report the round trip as the router's own cost — the measurement this exists to make
        // honest is which fraction of click -> paint the router's WORK is.
        beginLayer(LAYER_NAVIGATE)

        // 41.11 — WHAT THE TWO ADDRESSES SHARE IS NOT REBUILT. The comparison is by the MOUNT
        // rather than by the loader or the module record: the table holds an arrow per row, so
        // two routes under one layout name the same file through two different functions, and a
        // table written by hand may answer with a fresh record each call. The function a module
        // exports is the same function either way.
        const shared = this.shares(arriving)
        this.stopFrom(shared)
        // The region the arriving part goes into: the page region where nothing is kept, and the
        // deepest kept layout's own slot where something is.
        const into =
            shared === 0
                ? this.region
                : ((this.levels[shared - 1] as Level).slot as Region)
        // EMPTIED THROUGH THE PRIMITIVE EVERY OTHER REGION IS. `fillRegion(region)` with no build is
        // this removal, and it carries the 41.10 refusal for a region no longer in a document that
        // a hand-written walk swallows.
        fillRegion(into)
        const full = `${target.pathname}${target.search}${target.hash}`
        if (options.replace === true) history.replaceState(null, '', full)
        else history.pushState(null, '', full)
        // 39.6 — BEFORE THE BODY IS WIRED, so a `<title>` the reader sees is the page they are
        // arriving at rather than the one they left, for however long the mount takes. Every
        // level that is arriving contributes, outermost first, which is the order the server
        // wrote them in; a kept layout's head is already standing and is not applied again.
        for (let at = shared; at < arriving.length; at += 1) {
            const head = (arriving[at] as PageModule).head
            if (head !== undefined) applyHead(head())
        }
        // AT THE TOP OF THE CHAIN, NOT INSIDE `mountFrom`: it recurses one level per layout, and
        // `shares()` SUMS every measure of a name inside the op — so a pair inside the recursion
        // would count the innermost level once per level above it.
        beginLayer(LAYER_MOUNT)
        this.mountFrom(arriving, shared, into, found.params)
        endLayer(LAYER_MOUNT)
        if (options.keepScroll !== true) scrollTo(0, 0)
        endLayer(LAYER_NAVIGATE)
    }

    // How much of the arriving chain is already standing. Layouts only: the page is the level
    // that is always replaced, even where the address resolved to the same module with other
    // params, because its own bindings read those params.
    private shares(arriving: PageModule[]): number {
        const layouts = arriving.length - 1
        const standing = this.levels.length === 0 ? 0 : this.levels.length - 1
        let shared = 0
        while (
            shared < layouts &&
            shared < standing &&
            (this.levels[shared] as Level).module.default ===
                (arriving[shared] as PageModule).default
        )
            shared += 1
        return shared
    }

    // Stopped from the INSIDE OUT, so a layout's disposers run after the page's — the order a
    // scope's own teardown already has, and the one an author reading two `watch` cleanups in
    // two files would expect.
    private stopFrom(at: number): void {
        for (let level = this.levels.length - 1; level >= at; level -= 1)
            (this.levels[level] as Level).scope?.stop()
        this.levels.length = at
    }

    // 35.1 — THE CHAIN, MOUNTED. Each level is handed the one below it as `children` (32.19), so
    // a layout puts the page in its `<slot/>` with the same mechanism a caller writing markup
    // between two tags uses — and the router learns where that slot is on the way past, which is
    // what lets it swap the page there later without the layout knowing.
    //
    // THE CHILD'S SCOPE IS THE ROUTER'S, not the layout's: `mount` hands back nothing, so the
    // layout owns nothing below it and a kept layout cannot stop the page arriving under it.
    private mountFrom(
        modules: PageModule[],
        at: number,
        region: Region,
        params: Params,
    ): void {
        const module = modules[at] as PageModule
        const level: Level = { module, scope: undefined, slot: undefined }
        this.levels[at] = level
        const props = paramsProp(params)
        if (at < modules.length - 1)
            props.children = () => ({
                // NOTHING, because the level below carries its own markup (32.18): a module a
                // route reaches fills the region it is mounted against when that region is
                // empty, so the markup and the mount are one call rather than two.
                html: () => '',
                mount: (slot: Region): undefined => {
                    level.slot = slot
                    this.mountFrom(modules, at + 1, slot, params)
                    return undefined
                },
            })
        level.scope = module.default(region, props)
    }

    // The page the SERVER painted, wired where it stands. No fill happens — the region is not
    // empty — so this is the first render's hydration and not a second rendering of it.
    async hydrate(): Promise<void> {
        const found = this.match(location.pathname)
        if (found === undefined) return
        // A TICKET LIKE ANY OTHER NAVIGATION. `listenForRoutes` is attached before this is called,
        // so a click during the page module's own load is a `go` that supersedes it — and
        // hydrating on top of the markup that navigation had already put in the region wired the
        // arriving page's bindings to the departing page's nodes.
        this.navigation += 1
        const ticket = this.navigation
        // NO `applyHead` HERE. The document's head is the one the server wrote for this very
        // page, and re-applying would replace each contribution with an identical copy — which is
        // a `<link rel=stylesheet>` refetched and a flash of unstyled document on every load.
        const standing = await load(found.route)
        if (this.navigation !== ticket) return
        // THE HYDRATE SHARE, and it is the number `compiler-maximalist` said it would take first
        // and never had. Same name as the navigation's mount because it is the same work on the
        // same chain — what differs is the op it is a fraction of.
        beginLayer(LAYER_MOUNT)
        this.mountFrom(standing, 0, this.region, found.params)
        endLayer(LAYER_MOUNT)
    }
}

// A route's chain, loaded: the layouts it renders inside, outermost first, and the page last.
// One `Promise.all`, because a waterfall down a three-deep chain is three round trips for a
// navigation the reader is watching.
async function load(route: Compiled): Promise<PageModule[]> {
    return await Promise.all([
        ...route.layouts.map((layout) => layout()),
        route.load(),
    ])
}

// 33.4 — A PROP IS AN ACCESSOR. A page is mounted as any other component is, so its one prop is
// passed the way `renderComponent` passes a child's and the way `serveBuild` paints one: a
// function per key. Passed as the plain record it lowered to `params()` on a value that was not
// one, so every page with a `[param]` in its address hydrated dead — with its server markup
// already on screen, which is what kept it quiet.
//
// THE SHAPE IS FIXED HERE, `children` included: every compiled page and layout loads its props
// off this record, and a field added on a later path is a second hidden class for all of them.
// A level with nothing below it leaves the key present and undefined, which is what both
// emitted readers already test for.
function paramsProp(
    params: Params,
): Record<string, (() => unknown) | undefined> {
    return { params: () => params, children: undefined }
}

// THE REGION A ROUTER SWAPS PAGES IN. The server does not write these anchors — a page is the one
// region with nothing around it — so the router puts them round what the document already holds,
// which is the page the server painted. After this the page IS a region and every primitive a
// `{#if}` arm uses works on it unchanged.
//
// THE CLOSING ANCHOR GOES AFTER THE LAST THING THE PAGE WROTE, not at the end of the host: an app
// shell puts its module script in the host too, and a close anchor past it makes the script part
// of the page — so the first navigation removes the running app from the document. Scripts and
// links are the shell's, wherever they stand, and stay outside.
function pageRegion(host: Element): Region {
    const open = document.createComment(REGION_OPEN)
    const close = document.createComment(REGION_CLOSE)
    host.insertBefore(open, host.firstChild)
    let after: ChildNode | null = null
    // STOPPING AT `open` IS NOT AN EDGE CASE, it is the empty page: a document the server painted
    // nothing into has the opening anchor as its only child, and a scan that walks past it puts
    // the close anchor BEFORE the open one — a region that can never be filled, on exactly the
    // direct-hit a client router exists to answer.
    for (
        let node = host.lastChild;
        node !== null && node !== open;
        node = node.previousSibling
    )
        if (isShell(node)) after = node as ChildNode
        else break
    host.insertBefore(close, after)
    return { open, close }
}

// A COMMENT IS NOT SHELL. A page whose last region is a `{#if}` ends in that region's close
// anchor, and calling it shell would leave it outside the page — so only the three elements a
// shell actually carries are, plus the whitespace between them.
function isShell(node: Node): boolean {
    if (node.nodeType === 3) return (node.nodeValue ?? '').trim() === ''
    if (node.nodeType !== 1) return false
    const tag = (node as Element).tagName
    return tag === 'SCRIPT' || tag === 'LINK' || tag === 'STYLE'
}

// THE ROUTES, MOST SPECIFIC FIRST, and the router registered as this document's. Ranking here
// rather than asking the build to emit an order keeps the table a fact about the file tree.
export function startRouter(
    routes: Route[],
    host: Element = document.body,
): Router {
    const compiled: Compiled[] = []
    for (const route of routes)
        compiled.push({ ...route, segments: parseRoutePattern(route.pattern) })
    const router = new Router(pageRegion(host), rankBySpecificity(compiled))
    CURRENT_ROUTER.current = router
    return router
}
