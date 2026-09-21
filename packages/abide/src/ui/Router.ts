import { CURRENT_ROUTER, type NavigateOptions } from '#shared/CURRENT_ROUTER.ts'
import { matchRoute, type Params } from '#shared/matchRoute.ts'
import {
    compareRoutes,
    parseRoutePattern,
    type Segment,
} from '#shared/routePattern.ts'
import { applyHead } from './applyHead.ts'
import { REGION_CLOSE, REGION_OPEN } from './REGION.ts'
import { fillRegion, type Region } from './regionAt.ts'
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
}

type Compiled = Route & { segments: Segment[] }

// WHAT THE ROUTER PUT ON THE PAGE, so a navigation can take it back off. A page mounted into the
// region owns a `Scope` (12.13) and the router is the only thing that can remove its nodes, so the
// router is where that scope is stopped.
export class Router {
    region: Region
    routes: Compiled[]
    scope: Scope | undefined
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

    constructor(region: Region, routes: Compiled[]) {
        this.region = region
        this.routes = routes
        this.scope = undefined
        this.navigation = 0
    }

    match(pathname: string): { route: Compiled; params: Params } | undefined {
        for (const route of this.routes) {
            const params = matchRoute(route.segments, pathname)
            if (params !== null) return { route, params }
        }
        return undefined
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
        const ticket = (this.navigation += 1)
        const page = await found.route.load()
        // SUPERSEDED, so this navigation is over. Nothing has been touched yet, which is the whole
        // reason the ticket is checked here rather than after the mount.
        if (this.navigation !== ticket) return
        const mount = page.default
        this.scope?.stop()
        // EMPTIED THROUGH THE PRIMITIVE EVERY OTHER REGION IS. `fillRegion(region, '')` is this
        // removal, and it carries the 41.11 refusal for a region no longer in a document that a
        // hand-written walk swallows.
        fillRegion(this.region, '')
        const full = `${target.pathname}${target.search}${target.hash}`
        if (options.replace === true) history.replaceState(null, '', full)
        else history.pushState(null, '', full)
        // 39.7 — BEFORE THE BODY IS WIRED, so a `<title>` the reader sees is the page they are
        // arriving at rather than the one they left, for however long the mount takes.
        if (page.head !== undefined) applyHead(page.head())
        this.scope = mount(this.region, paramsProp(found.params))
        if (options.keepScroll !== true) scrollTo(0, 0)
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
        const ticket = (this.navigation += 1)
        // NO `applyHead` HERE. The document's head is the one the server wrote for this very
        // page, and re-applying would replace each contribution with an identical copy — which is
        // a `<link rel=stylesheet>` refetched and a flash of unstyled document on every load.
        const { default: mount } = await found.route.load()
        if (this.navigation !== ticket) return
        this.scope = mount(this.region, paramsProp(found.params))
    }
}

// 33.4 — A PROP IS AN ACCESSOR. A page is mounted as any other component is, so its one prop is
// passed the way `renderComponent` passes a child's and the way `serveBuild` paints one: a
// function per key. Passed as the plain record it lowered to `params()` on a value that was not
// one, so every page with a `[param]` in its address hydrated dead — with its server markup
// already on screen, which is what kept it quiet.
function paramsProp(params: Params): Record<string, () => unknown> {
    return { params: () => params }
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
    compiled.sort((a, b) => compareRoutes(a.segments, b.segments))
    const router = new Router(pageRegion(host), compiled)
    CURRENT_ROUTER.current = router
    return router
}
