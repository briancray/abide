import { CURRENT_ROUTER, type NavigateOptions } from '#shared/CURRENT_ROUTER.ts'
import { decodedOrKept } from '#shared/decodedOrKept.ts'
import { ERROR_META } from '#shared/ERROR_META.ts'
import { firstMatch, partsOf } from '#shared/matchRoute.ts'
import { unmounted } from '#shared/mount.ts'
import { NAVIGATION_HEADER } from '#shared/NAVIGATION_HEADER.ts'
import { OFFLINE_SAVED } from '#shared/OFFLINE_CACHES.ts'
import { REACHED_MESSAGE } from '#shared/REACHED_MESSAGE.ts'
import { arrive, route } from '#shared/route.ts'
import { rankRoutes, type Segment } from '#shared/routePattern.ts'
import { paintedCallsLanded } from '#shared/takeEarlyCall.ts'

import { LAYER_NAVIGATE } from './LAYER_NAMES.ts'
import { LevelChain, type PageModule } from './LevelChain.ts'
import { beginLayer, endLayer } from './measureLayer.ts'
import {
    type Bearing,
    type Found,
    outcomeOf,
    type Settled,
} from './outcomeOf.ts'
import { pageRegion, type Region } from './regions.ts'

export type Route = {
    /** The route literal, in the bracket spelling the page's directory is already written in. */
    pattern: string
    load: () => Promise<PageModule>
    /**
     * The layouts this page renders inside, outermost first, as the build found them (35.1).
     *
     * REQUIRED, as it is on the server's own row (`ServerRoute`): `tableOf` writes the key into
     * both tables unconditionally, so every row has one shape.
     */
    layouts: (() => Promise<PageModule>)[]
}

type Compiled = Route & { segments: Segment[] }

/** A window's scroll, `[scrollX, scrollY]`. */
type Scroll = readonly [number, number]

/**
 * What the router writes to `history.state`: the entry's place in this document's history, and the
 * scroll it was left at where the router could write it before leaving (30.29, 30.30).
 */
type Entry = { index: number; scroll: Scroll | null }

/**
 * How a navigation arrives at its entry: the view transition type it carries (39.18), and the scroll
 * it restores on a history step (30.29).
 */
type Step = {
    direction: 'push' | 'back' | 'forward'
    scroll: Scroll | undefined
}

const PUSHED: Step = { direction: 'push', scroll: undefined }

/** What a superseded navigation's ticket is aborted with. */
const SUPERSEDED = 'superseded'

/**
 * The client router: matches addresses, and mounts and replaces the page chain.
 *
 * It holds what it put on the page, so a navigation can take it back off. A page mounted into the
 * region owns a `Scope` (12.13) and the router is the only thing that can remove its nodes, so the
 * router — through its `LevelChain` — is where that scope is stopped. The router keeps the address,
 * the history and the scroll.
 */
export class Router {
    readonly region: Region
    private readonly routes: Compiled[]
    /** The chain standing in the document, outermost layout first and the page last. */
    readonly levels: LevelChain
    /**
     * The path the standing chain was mounted for: a step to it that moves only the query or the
     * fragment keeps the page (30.23, 30.24).
     */
    private mounted: string | undefined
    /**
     * The route the standing page was matched by.
     *
     * 30.23 — an address it matches again keeps it.
     */
    private standing: Compiled | undefined
    /**
     * The ticket of the live navigation; a superseded one stops when it sees its own aborted.
     *
     * Both ways in await the destination's module before they touch anything, and a dynamic import
     * resolves in whatever order the chunks arrive — so two clicks, or a click landing while
     * `hydrate` is still loading, each mounted a page: the second one to finish overwrote the
     * standing scope and the first page's bindings were left awake, writing into nodes the other
     * page had replaced. Nothing about the screen showed it — the newest markup was on top — which
     * is why each navigation takes a ticket of its own rather than sharing a flag.
     *
     * TAKEN BEFORE THE AWAIT AND CHECKED AFTER IT, so a superseded navigation stops before it
     * stops a scope, empties the region or pushes a history entry for a page nobody will see.
     *
     * 30.31 — AN `AbortController`, so superseding a navigation also aborts the `middleware` request
     * it is still waiting on, rather than leaving it to finish for nobody.
     */
    private navigation: AbortController
    /**
     * 35.18 — whether the document is an error page's. Its markup is no page this router has, so
     * nothing hydrates over it, and leaving it is a document load.
     */
    private readonly errorPage: boolean
    /**
     * The place in this document's history of the entry the address bar stands at (`Entry`).
     *
     * 23.28 — `route.index` IS THIS, moved where `route.url` is (`arrive`) rather than here: a back
     * step moves this before the page it arrives at has loaded.
     */
    private index: number
    /**
     * 30.29 — the scroll each entry was left at, by its `index`.
     *
     * HELD HERE AS WELL AS IN `history.state`, because a back or forward step has already moved the
     * bar when `popstate` arrives, so the entry it left can no longer be written to.
     */
    private readonly scrolls: (Scroll | undefined)[]
    /**
     * The routes whose chunks `prefetch` has already asked for.
     *
     * `pointerover` bubbles, so a pointer crossing a link's children asks again at every edge, and
     * after the first time the answer is the module cache's anyway.
     */
    private readonly prefetched: Set<Compiled>
    /**
     * Whether a navigation's write is a view transition, as the build read it (39.7, 39.8).
     *
     * Read off the compiled `<style>` blocks. Nothing here looks at the document's stylesheets.
     */
    private readonly transitions: boolean
    /**
     * 30.38 — what settles each `step` still waiting on the browser to say it has arrived.
     *
     * Settled ALL AT ONCE by the next arrival, rather than one per `popstate`: a browser that folds
     * two queued `history.go`s into one traversal fires one event, and a step waiting for a second
     * would never settle.
     */
    private readonly stepping: (() => void)[]

    constructor(region: Region, routes: Compiled[], transitions: boolean) {
        this.region = region
        this.routes = routes
        this.levels = new LevelChain(region)
        this.mounted = undefined
        this.standing = undefined
        this.navigation = new AbortController()
        this.errorPage =
            document.querySelector(`meta[name="${ERROR_META}"]`) !== null
        const state = history.state as Partial<Entry> | null
        if (typeof state?.index === 'number') this.index = state.index
        else {
            this.index = 0
            history.replaceState(entryAt(this.index, null), '')
        }
        this.scrolls = []
        this.prefetched = new Set()
        this.transitions = transitions
        this.stepping = []
    }

    /**
     * The route and params an address matches, or `undefined` for one this app has no route for.
     *
     * 16.10 — AN ADDRESS OUTSIDE THE MOUNT IS NO ROUTE OF THIS APP'S, and one inside it is matched
     * as the address below the app's root. Every way in — a click, an intent, back and forward, a
     * hydration — is matched here.
     */
    match(pathname: string): Found<Compiled> | undefined {
        const below = unmounted(pathname)
        const parts = below === undefined ? undefined : partsOf(below)
        return parts === undefined ? undefined : firstMatch(this.routes, parts)
    }

    /**
     * Loads a route's chunks ahead of a navigation the reader has signaled.
     *
     * 30.14 — A NAVIGATION THE READER HAS SIGNALED, LOADED BEFORE IT HAPPENS: the route's chunks
     * are asked for on intent, so the click finds them in the module cache and setup — and with it
     * every call the page makes — starts at once. Only the CODE: a call run on a hover would be a
     * call nobody asked for, and for anything but a `GET` one with an effect. A failed load is left
     * for the click, which hands the address to the document (30.27), and the next intent asks again.
     */
    prefetch(pathname: string): void {
        const route = this.match(pathname)?.route
        if (route === undefined || this.prefetched.has(route)) return
        this.prefetched.add(route)
        load(route).catch(() => this.prefetched.delete(route))
    }

    /**
     * Navigates to `url` without reloading the document.
     *
     * 30.7 — NAVIGATES, AND DOES NOT RELOAD. Everything between the anchors is replaced and the
     * document, its history entry and every module already loaded stay exactly where they are.
     *
     * THE MARKUP COMES FROM THE PAGE'S OWN MODULE. A page the server painted arrives with its
     * markup between the anchors and hydrates; a page navigated TO arrives as the empty pair and
     * fills itself from the template it carries. One module, both ways in — the `fillEmpty`
     * the emitter already writes is the whole of the difference.
     */
    go(url: URL | string, options: NavigateOptions = {}): Promise<void> {
        return this.travel(url, options, PUSHED)
    }

    /**
     * Arrives at the entry a back or forward step has already moved the address bar to.
     *
     * The page is mounted where the bar already points and nothing is pushed for it. 30.20 — a step
     * within the standing page, back over an in-page `#anchor` jump, is `follow`'s: nothing asked,
     * nothing remounted. 30.29 — the scroll is put back once the page it belongs to is mounted.
     */
    async popped(): Promise<void> {
        try {
            await this.travel(
                location.href,
                { replace: true, keepScroll: true },
                this.stepped(),
            )
        } finally {
            for (const arrived of this.stepping.splice(0)) arrived()
        }
    }

    /**
     * Steps the history by `by` entries, settling once the entry stepped to is arrived at.
     *
     * 30.38 — THE BROWSER MOVES THE BAR LATER and says so only by `popstate`, so the step settles in
     * `popped`, once the arriving page is mounted and its scroll put back. 30.39 — `history.go(0)`
     * reloads the document, which no `navigate` does, so a step of none is over before it starts.
     */
    step(by: number): Promise<void> {
        if (by === 0) return Promise.resolve()
        return new Promise((arrived) => {
            this.stepping.push(arrived)
            history.go(by)
        })
    }

    /** `go`, arriving as `step` says: a push, or a history step with the scroll it restores. */
    private async travel(
        url: URL | string,
        options: NavigateOptions,
        step: Step,
    ): Promise<void> {
        const bearing: Bearing<Compiled> = {
            target: typeof url === 'string' ? new URL(url, location.href) : url,
            origin: location.origin,
            errorPage: this.errorPage,
            standing: this.standing,
            mounted: this.mounted,
            match: (pathname) => this.match(pathname),
        }
        const before = outcomeOf(bearing)
        if (before.kind !== 'ask') return this.settle(before, options, step)
        const found = before.found
        const ticket = this.supersede()
        route.navigating.set(true)
        // EVERY WAY OUT CLEARS WHAT THE WAY IN SET: a load that fails, a setup that throws and a
        // navigation that completes all leave `navigating` false and every layer closed. A
        // superseded one leaves `navigating` to the navigation that superseded it.
        try {
            // 30.15 — THE SERVER IS ASKED ALONGSIDE THE LOAD, so its `middleware` decides the
            // navigation for the price of the one round trip the chunks already cost.
            // 30.27 — `loadOrMiss`, because a rejection here was dropped by the click's `void`,
            // and the link did nothing.
            const [answer, loaded] = await Promise.all([
                ask(bearing.target, ticket.signal),
                loadOrMiss(found.route),
            ])
            // SUPERSEDED, so this navigation is over. Nothing has been touched yet, which is the
            // whole reason the ticket is checked here rather than after the mount — and
            // `navigating` stays the newer navigation's to clear.
            if (ticket.signal.aborted) return
            const after = outcomeOf(bearing, {
                found,
                answer,
                loaded: loaded !== undefined,
                online: navigator.onLine,
                pushed: step.direction === 'push',
            })
            if (after.kind === 'offline') {
                // 45.12 — UNLESS THE SERVICE WORKER SAVED THE PAGE, which the document load is
                // then answered with.
                if (
                    (await savedOffline(bearing.target)) &&
                    !ticket.signal.aborted
                )
                    location.href = after.href
                return
            }
            if (after.kind !== 'mount') return this.settle(after, options, step)
            const arriving =
                after.found === found
                    ? loaded
                    : await loadOrMiss(after.found.route)
            if (ticket.signal.aborted) return
            if (arriving === undefined) {
                location.href = after.at.href
                return
            }
            await this.write(ticket, step.direction, () =>
                this.commit(after.at, after.found, arriving, options, step),
            )
        } finally {
            if (this.navigation === ticket) route.navigating.set(false)
        }
    }

    /** Executes an outcome that loads nothing: a document load, or a step within the page. */
    private settle(
        outcome: Settled<Compiled>,
        options: NavigateOptions,
        step: Step,
    ): void {
        if (outcome.kind === 'document') location.href = outcome.href
        else this.follow(outcome.at, options, outcome.found, step)
    }

    /**
     * Moves the address within the standing page, leaving the page mounted.
     *
     * A STEP WITHIN THE STANDING PAGE: the address written and `route` moved, and the page, its
     * scope and every call it made left where they are. It supersedes a navigation in flight the
     * way a click on another link would. Back and forward arrive here with the bar already moved
     * and `keepScroll`, and with the scroll the entry was left at (30.29).
     *
     * 30.25 — THE SCROLL STAYS where no page was replaced, except to a fragment the address names:
     * a reader choosing a season is not sent back to the top of the series.
     */
    follow(
        target: URL,
        options: NavigateOptions,
        found: Found<Compiled>,
        step: Step,
    ): void {
        this.supersede()
        route.navigating.set(false)
        // THE SAME ADDRESS REPLACES rather than pushing, which is what the browser does for a
        // link to the fragment it is already at.
        this.writeAddress(
            target,
            options.replace === true || target.href === location.href,
            [scrollX, scrollY],
        )
        arrive(target.href, found.route.pattern, found.params, this.index)
        this.mounted = target.pathname
        if (step.scroll !== undefined) scrollTo(step.scroll[0], step.scroll[1])
        else if (options.keepScroll !== true && target.hash !== '')
            scrollToFragment(target.hash)
    }

    /**
     * Records a back or forward step the browser has already taken; answers how to arrive.
     *
     * 30.29 — THE ENTRY LEFT keeps the scroll it stood at, and the one arrived at hands back its own.
     * 39.18 — the direction is read off the two entries' `index`. An entry with none is one the
     * browser pushed itself — a link to a fragment — so it is stamped as the next entry, and
     * arrived at as a push.
     */
    private stepped(): Step {
        this.scrolls[this.index] = [scrollX, scrollY]
        const state = history.state as Partial<Entry> | null
        if (typeof state?.index !== 'number') {
            this.index += 1
            this.scrolls.length = this.index
            history.replaceState(entryAt(this.index, null), '')
            return PUSHED
        }
        const direction = state.index < this.index ? 'back' : 'forward'
        this.index = state.index
        return {
            direction,
            scroll: this.scrolls[state.index] ?? state.scroll ?? undefined,
        }
    }

    /**
     * Writes the scroll the standing entry is at into its `history.state`, where a reload finds it
     * (30.30) — the one way out of an entry the router cannot write to after it leaves.
     */
    remember(scroll: Scroll = [scrollX, scrollY]): void {
        this.scrolls[this.index] = scroll
        history.replaceState(entryAt(this.index, scroll), '')
    }

    /**
     * Aborts the live navigation and answers the ticket of the one replacing it.
     *
     * ABORTED WITH A REASON, because `abort()` with none builds a `DOMException`, stack trace and
     * all — 1.1 ms of every page load in Chromium, where hydrate supersedes a ticket nothing holds.
     */
    private supersede(): AbortController {
        this.navigation.abort(SUPERSEDED)
        this.navigation = new AbortController()
        return this.navigation
    }

    /**
     * Writes `target` to the address bar, pushing a new entry or replacing the standing one.
     *
     * 30.29 — A PUSH LEAVES AN ENTRY, so the scroll it stood at is written to it first, and every
     * entry after it is gone from the history the push forked. `left` is that scroll, read by the
     * caller before it wrote anything: read after a region was emptied, it forces a layout and
     * reads the offset that layout clamped.
     */
    private writeAddress(target: URL, replace: boolean, left: Scroll): void {
        const full = `${target.pathname}${target.search}${target.hash}`
        // A step to a fragment, or to the address standing, reaches no page the worker lacks.
        const moved =
            target.pathname !== location.pathname ||
            target.search !== location.search
        if (replace) history.replaceState(entryAt(this.index, null), '', full)
        else {
            this.remember(left)
            this.index += 1
            this.scrolls.length = this.index
            history.pushState(entryAt(this.index, null), '', full)
        }
        if (moved) reached(target)
    }

    /**
     * Runs a navigation's commit, inside a view transition where one is wanted.
     *
     * 39.9 — AWAITED TO THE WRITE, NOT TO THE ANIMATION: `updateCallbackDone` settles once the
     * arriving page is in the document, and `finished` would hold the navigation for however long
     * the app's transition plays. 39.10 — a browser with no `startViewTransition` writes directly.
     *
     * THE TICKET IS CHECKED AGAIN INSIDE THE CALLBACK, because the browser runs it a frame later,
     * after capturing the outgoing page — and a transition another navigation skipped still runs
     * its callback, which would mount the page the reader clicked away from.
     *
     * 39.18 — TYPED WITH THE DIRECTION, so the stylesheet decides what a back step looks like
     * (`:active-view-transition-type(back)`). 39.19 — a browser whose transitions take no types is
     * handed the callback alone: the options form is a `TypeError` there.
     */
    private async write(
        ticket: AbortController,
        direction: Step['direction'],
        commit: () => void,
    ): Promise<void> {
        if (
            !this.transitions ||
            typeof document.startViewTransition !== 'function'
        )
            return commit()
        const update = (): void => {
            if (!ticket.signal.aborted) commit()
        }
        await document.startViewTransition(
            takesTypes() ? { update, types: [direction] } : update,
        ).updateCallbackDone
    }

    /**
     * Commits a navigation: empties the old part, writes the address and mounts the new part.
     *
     * What a navigation does once it is no longer supersedable: the old part stopped and emptied,
     * the address written, the arriving part's head applied and its levels mounted.
     */
    private commit(
        target: URL,
        found: Found<Compiled>,
        arriving: PageModule[],
        options: NavigateOptions,
        step: Step,
    ): void {
        // OPENED WHERE THE NAVIGATION COMMITS, which is after the last early exit and after the
        // `await` above. The awaited load is a NETWORK wait, and a layer that contained it would
        // report the round trip as the router's own cost — the measurement this exists to make
        // honest is which fraction of click -> paint the router's WORK is.
        beginLayer(LAYER_NAVIGATE)
        try {
            // 41.11 — WHAT THE TWO ADDRESSES SHARE IS NOT REBUILT.
            const kept = this.levels.sharedWith(arriving)
            // Read before anything is written: read after a region was emptied, it forces a layout
            // and reads the offset that layout clamped.
            const left: Scroll = [scrollX, scrollY]
            this.levels.replace(kept, arriving, () => {
                this.writeAddress(target, options.replace === true, left)
                this.arriveAt(target, found)
            })
            // 30.29 — where the entry was left, on a history step; else the top of the page, or —
            // as the browser does on a load — the fragment's element.
            if (step.scroll !== undefined)
                scrollTo(step.scroll[0], step.scroll[1])
            else if (options.keepScroll !== true) scrollToFragment(target.hash)
        } finally {
            endLayer(LAYER_NAVIGATE)
        }
    }

    /**
     * Hydrates the page the server painted, wiring it where it stands.
     *
     * No fill happens — the region is not empty — so this is the first render's hydration and not a
     * second rendering of it.
     */
    async hydrate(): Promise<void> {
        const found = this.errorPage ? undefined : this.match(location.pathname)
        if (found === undefined) return
        // A TICKET LIKE ANY OTHER NAVIGATION. `listenForRoutes` is attached before this is called,
        // so a click during the page module's own load is a `go` that supersedes it — and
        // hydrating on top of the markup that navigation had already put in the region wired the
        // arriving page's bindings to the departing page's nodes.
        const ticket = this.supersede()
        // NO HEAD IS APPLIED FOR A PAINTED PAGE: its region is not empty, so its mount hydrates
        // rather than fills, and the head is the one the server wrote. Re-applying would replace
        // each contribution with an identical copy — a `<link rel=stylesheet>` refetched and a
        // flash of unstyled document on every load.
        // 41.25 — AND THE CALLS THE SERVER PAINTED SETTLED ARE WAITED FOR, so setup reads each one
        // answered, as the markup was built from it, and picks the arm the server painted.
        const landing = paintedCallsLanded()
        const standing = await load(found.route)
        if (landing !== undefined) await landing
        if (ticket.signal.aborted) return
        // THE HYDRATE SHARE. Same name as the navigation's mount because it is the same work on the
        // same chain — what differs is the op it is a fraction of.
        this.arriveAt(new URL(location.href), found)
        this.levels.hydrate(standing)
        // 30.30 — A RELOAD lands on an entry that carries the scroll `remember` wrote on the way out.
        const scroll = (history.state as Partial<Entry> | null)?.scroll
        if (scroll != null) scrollTo(scroll[0], scroll[1])
    }

    /**
     * Records the arriving route as standing at `target`.
     *
     * 23.1 — WRITTEN BEFORE THE ARRIVING PAGE'S SETUP, which reads it.
     */
    private arriveAt(target: URL, found: Found<Compiled>): void {
        arrive(target.href, found.route.pattern, found.params, this.index)
        this.standing = found.route
        this.mounted = target.pathname
    }
}

/**
 * Loads a route's chain: its layouts, outermost first, and the page last.
 *
 * One `Promise.all`, because a waterfall down a three-deep chain is three round trips for a
 * navigation the reader is watching.
 */
async function load(route: Compiled): Promise<PageModule[]> {
    return await Promise.all([
        ...route.layouts.map((layout) => layout()),
        route.load(),
    ])
}

/** A route's chain as `load` gives it; `undefined` where a chunk failed to load. */
function loadOrMiss(route: Compiled): Promise<PageModule[] | undefined> {
    return load(route).catch(() => undefined)
}

/** Whether a service worker controls the page and saved `target`'s page (45.12). */
async function savedOffline(target: URL): Promise<boolean> {
    if (navigator.serviceWorker?.controller == null) return false
    const saved = await caches.match(target.href, {
        cacheName: OFFLINE_SAVED,
        ignoreVary: true,
    })
    return saved !== undefined
}

/**
 * Tells the service worker an address a navigation reached, for it to keep (45.24).
 *
 * POSTED AS THE ADDRESS IS WRITTEN, rather than heard from 30.15's ask: a step within the standing
 * route asks nothing, the ask's redirect lands elsewhere than it asked, and a superseded one writes
 * no address.
 */
function reached(at: URL): void {
    const controller = navigator.serviceWorker?.controller
    if (controller == null) return
    // A page is kept by its address, which a fragment is no part of.
    const address = new URL(at)
    address.hash = ''
    controller.postMessage({ [REACHED_MESSAGE]: address.href })
}

/**
 * Asks the server's `middleware` about an address; `undefined` where the fetch failed.
 *
 * 30.15 — THE ADDRESS, THROUGH THE SERVER'S `middleware` AND NOT ITS RENDER (30.16). A redirect
 * is followed here, carrying the header, so the answer at the end of it is the server's go-ahead
 * for the address it landed on.
 */
async function ask(
    target: URL,
    signal: AbortSignal,
): Promise<Response | undefined> {
    try {
        return await fetch(target, {
            headers: { [NAVIGATION_HEADER]: '1' },
            cache: 'no-store',
            signal,
        })
    } catch {
        return undefined
    }
}

function entryAt(index: number, scroll: Scroll | null): Entry {
    return { index, scroll }
}

/**
 * Whether this browser's view transitions take `types` (39.19).
 *
 * Asked of `ViewTransition`'s prototype, where a browser that knows types puts the member.
 */
function takesTypes(): boolean {
    return (
        typeof ViewTransition === 'function' &&
        'types' in ViewTransition.prototype
    )
}

/**
 * Scrolls a fragment's element into view, or to the top where there is none.
 *
 * 30.22 — WHAT THE BROWSER DOES WITH A FRAGMENT: its element — by id, then a named `<a>` — brought
 * into view, and the top of the page where there is none or it names none. A fragment that will not
 * percent-decode is looked up as written.
 */
function scrollToFragment(hash: string): void {
    const id = decodedOrKept(hash.slice(1))
    if (id !== '') {
        const byId = document.getElementById(id)
        if (byId !== null) {
            byId.scrollIntoView()
            return
        }
        for (const named of document.getElementsByName(id))
            if (named instanceof HTMLAnchorElement) {
                named.scrollIntoView()
                return
            }
    }
    scrollTo(0, 0)
}

/**
 * Builds the router over `routes` and registers it as this document's.
 *
 * Routes are ranked most specific first. Ranking here rather than asking the build to emit an order
 * keeps the table a fact about the file tree.
 */
export function startRouter(
    routes: Route[],
    host: Element = document.body,
    transitions = false,
): Router {
    const router = new Router(pageRegion(host), rankRoutes(routes), transitions)
    CURRENT_ROUTER.current = router
    return router
}
