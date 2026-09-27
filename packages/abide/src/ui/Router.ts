import { CURRENT_ROUTER, type NavigateOptions } from '#shared/CURRENT_ROUTER.ts'
import { firstMatch, type Params, partsOf } from '#shared/matchRoute.ts'
import { unmounted } from '#shared/mount.ts'
import { NAVIGATION_HEADER } from '#shared/NAVIGATION_HEADER.ts'
import { arrive, route } from '#shared/route.ts'
import {
    parseRoutePattern,
    rankBySpecificity,
    type Segment,
} from '#shared/routePattern.ts'
import { applyHead } from './applyHead.ts'
import { LAYER_MOUNT, LAYER_NAVIGATE } from './LAYER_NAMES.ts'
import { beginLayer, endLayer } from './measureLayer.ts'
import { fillRegion, pageRegion, type Region } from './regions.ts'
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
    // both tables unconditionally, so every row has one shape.
    layouts: (() => Promise<PageModule>)[]
}

type Compiled = Route & { segments: Segment[] }

type Found = { route: Compiled; params: Params }

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
    // 39.7, 39.8 — WHETHER A NAVIGATION'S WRITE IS A VIEW TRANSITION, as the build read it off the
    // compiled `<style>` blocks. Nothing here looks at the document's stylesheets.
    transitions: boolean

    constructor(region: Region, routes: Compiled[], transitions: boolean) {
        this.region = region
        this.routes = routes
        this.levels = []
        this.navigation = 0
        this.prefetched = new Set()
        this.transitions = transitions
    }

    // 16.11 — AN ADDRESS OUTSIDE THE MOUNT IS NO ROUTE OF THIS APP'S, and one inside it is matched
    // as the address below the app's root. Every way in — a click, an intent, back and forward, a
    // hydration — is matched here.
    match(pathname: string): Found | undefined {
        const below = unmounted(pathname)
        const parts = below === undefined ? undefined : partsOf(below)
        return parts === undefined ? undefined : firstMatch(this.routes, parts)
    }

    // 30.14 — A NAVIGATION THE READER HAS SIGNALLED, LOADED BEFORE IT HAPPENS: the route's chunks
    // are asked for on intent, so the click finds them in the module cache and setup — and with it
    // every call the page makes — starts at once. Only the CODE: a call run on a hover would be a
    // call nobody asked for, and for anything but a `GET` one with an effect. A failed load is left
    // for the click, which reports it, and the next intent asks again.
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
        route.navigating.set(true)
        // EVERY WAY OUT CLEARS WHAT THE WAY IN SET: a load that fails, a setup that throws and a
        // navigation that completes all leave `navigating` false and every layer closed. A
        // superseded one leaves `navigating` to the navigation that superseded it.
        try {
            // 30.15 — THE SERVER IS ASKED ALONGSIDE THE LOAD, so its `middleware` decides the
            // navigation for the price of the one round trip the chunks already cost.
            const [answer, loaded] = await Promise.all([
                ask(target),
                load(found.route),
            ])
            // SUPERSEDED, so this navigation is over. Nothing has been touched yet, which is the
            // whole reason the ticket is checked here rather than after the mount — and
            // `navigating` stays the newer navigation's to clear.
            if (this.navigation !== ticket) return
            // 30.18 — A REFUSAL, A RESPONSE MIDDLEWARE ANSWERED ITSELF, or no answer at all: the
            // document asks again and paints whatever the server says. A fetch that failed —
            // offline, or a redirect to another origin that CORS will not let it follow — goes to
            // the address it was sent to.
            if (answer?.status !== 204) {
                location.href = answer?.url ?? target.href
                return
            }
            // 30.17 — REDIRECTED, and the server already said yes to where it landed: the answer is
            // the 204 at the end of the chain. That address is mounted in place of the one asked
            // for, and a route the client has no row for is the document's (30.10).
            const landed = answer.redirected ? new URL(answer.url) : target
            const landing = answer.redirected
                ? this.match(landed.pathname)
                : found
            if (landing === undefined) {
                location.href = landed.href
                return
            }
            const arriving =
                landing === found ? loaded : await load(landing.route)
            if (this.navigation !== ticket) return
            await this.write(ticket, () =>
                this.commit(landed, landing, arriving, options),
            )
        } finally {
            if (this.navigation === ticket) route.navigating.set(false)
        }
    }

    // 39.9 — AWAITED TO THE WRITE, NOT TO THE ANIMATION: `updateCallbackDone` settles once the
    // arriving page is in the document, and `finished` would hold the navigation for however long
    // the app's transition plays. 39.10 — a browser with no `startViewTransition` writes directly.
    //
    // THE TICKET IS CHECKED AGAIN INSIDE THE CALLBACK, because the browser runs it a frame later,
    // after capturing the outgoing page — and a transition another navigation skipped still runs
    // its callback, which would mount the page the reader clicked away from.
    private async write(ticket: number, commit: () => void): Promise<void> {
        if (
            !this.transitions ||
            typeof document.startViewTransition !== 'function'
        )
            return commit()
        await document.startViewTransition(() => {
            if (this.navigation === ticket) commit()
        }).updateCallbackDone
    }

    // WHAT A NAVIGATION DOES ONCE IT IS NO LONGER SUPERSEDABLE: the old part stopped and emptied,
    // the address written, the arriving part's head applied and its levels mounted.
    private commit(
        target: URL,
        found: Found,
        arriving: PageModule[],
        options: NavigateOptions,
    ): void {
        // OPENED WHERE THE NAVIGATION COMMITS, which is after the last early exit and after the
        // `await` above. The awaited load is a NETWORK wait, and a layer that contained it would
        // report the round trip as the router's own cost — the measurement this exists to make
        // honest is which fraction of click -> paint the router's WORK is.
        beginLayer(LAYER_NAVIGATE)
        try {
            // 41.11 — WHAT THE TWO ADDRESSES SHARE IS NOT REBUILT. The comparison is by the MOUNT
            // rather than by the loader or the module record: the table holds an arrow per row, so
            // two routes under one layout name the same file through two different functions, and a
            // table written by hand may answer with a fresh record each call. The function a module
            // exports is the same function either way.
            const shared = this.shares(arriving)
            this.stopFrom(shared)
            // The region the arriving part goes into: the page region where nothing is kept, and
            // the deepest kept layout's own slot where something is.
            const into =
                shared === 0
                    ? this.region
                    : ((this.levels[shared - 1] as Level).slot as Region)
            // EMPTIED THROUGH THE PRIMITIVE EVERY OTHER REGION IS. `fillRegion(region)` with no
            // build is this removal, and it carries the 41.10 refusal for a region no longer in a
            // document that a hand-written walk swallows.
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
            this.mountChain(target.href, found, arriving, shared, into)
            if (options.keepScroll !== true) scrollTo(0, 0)
        } finally {
            endLayer(LAYER_NAVIGATE)
        }
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
                // NO BUILD, because the level below carries its own (32.18): a module a route
                // reaches fills the region it is mounted against when that region is empty, so
                // the build and the mount are one call rather than two.
                build: undefined,
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
        // THE HYDRATE SHARE. Same name as the navigation's mount because it is the same work on the
        // same chain — what differs is the op it is a fraction of.
        this.mountChain(location.href, found, standing, 0, this.region)
    }

    // AT THE TOP OF THE CHAIN, NOT INSIDE `mountFrom`: it recurses one level per layout, and
    // `shares()` SUMS every measure of a name inside the op — so a pair inside the recursion would
    // count the innermost level once per level above it. 23.1 — WRITTEN BEFORE THE ARRIVING PAGE'S
    // SETUP, which reads it.
    private mountChain(
        href: string,
        found: Found,
        modules: PageModule[],
        from: number,
        into: Region,
    ): void {
        arrive(href, found.route.pattern, found.params)
        beginLayer(LAYER_MOUNT)
        try {
            this.mountFrom(modules, from, into, found.params)
        } finally {
            endLayer(LAYER_MOUNT)
        }
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

// 30.15 — THE ADDRESS, THROUGH THE SERVER'S `middleware` AND NOT ITS RENDER (30.16). A redirect
// is followed here, carrying the header, so the answer at the end of it is the server's go-ahead
// for the address it landed on.
async function ask(target: URL): Promise<Response | undefined> {
    try {
        return await fetch(target, {
            headers: { [NAVIGATION_HEADER]: '1' },
            cache: 'no-store',
        })
    } catch {
        return undefined
    }
}

// 33.4 — A PROP IS AN ACCESSOR. A page is mounted as any other component is, so its one prop is
// passed the way `renderComponent` passes a child's and the way `answerRequest` paints one: a
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

// THE ROUTES, MOST SPECIFIC FIRST, and the router registered as this document's. Ranking here
// rather than asking the build to emit an order keeps the table a fact about the file tree.
export function startRouter(
    routes: Route[],
    host: Element = document.body,
    transitions = false,
): Router {
    const compiled: Compiled[] = []
    for (const route of routes)
        compiled.push({ ...route, segments: parseRoutePattern(route.pattern) })
    const router = new Router(
        pageRegion(host),
        rankBySpecificity(compiled),
        transitions,
    )
    CURRENT_ROUTER.current = router
    return router
}
