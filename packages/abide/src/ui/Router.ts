import { CURRENT_ROUTER, type NavigateOptions } from '#shared/CURRENT_ROUTER.ts'
import { decodedOrKept } from '#shared/decodedOrKept.ts'
import { ERROR_META } from '#shared/ERROR_META.ts'
import { firstMatch, type Params, partsOf } from '#shared/matchRoute.ts'
import { unmounted } from '#shared/mount.ts'
import { NAVIGATION_HEADER } from '#shared/NAVIGATION_HEADER.ts'
import { OFFLINE_SAVED } from '#shared/OFFLINE_CACHES.ts'
import type { ShareScope } from '#shared/reactive/share.ts'
import { arrive, route } from '#shared/route.ts'
import { rankRoutes, type Segment } from '#shared/routePattern.ts'
import { setUpLevels } from '#shared/setUpLevels.ts'
import { paintedCallsLanded } from '#shared/takeEarlyCall.ts'
import { withdrawHead } from './applyHead.ts'
import { LAYER_MOUNT, LAYER_NAVIGATE } from './LAYER_NAMES.ts'
import { Level } from './Level.ts'
import { beginLayer, endLayer } from './measureLayer.ts'
import { fillRegion, pageRegion, type Region } from './regions.ts'
import type { Scope, Stoppable } from './Scope.ts'

/**
 * A page's client mount, called against the region the router owns.
 *
 * The same default export a page already has — the router is a CALLER of a page exactly as a page
 * is a caller of a component, which is why nothing about the emitted module changes to be routable.
 */
export type PageMount = (
    root: Region,
    props?: Record<string, unknown>,
    // 39.6 — A LEVEL'S HEAD IS ITS OWN MOUNT'S TO APPLY, from inside the instance its slots read
    // (`emitClient`), so the router hands the module a region and says it is the router by handing
    // it the level it stands at — a file invoked as a component too is mounted without it, and
    // applies no head a row. 39.14 — the level is where the mount leaves its head for the router
    // to read when it withdraws.
    routed?: Level,
) => Scope

type PageModule = { default: PageMount }

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

type Found = { route: Compiled; params: Params }

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
 * router is where that scope is stopped.
 */
export class Router {
    region: Region
    routes: Compiled[]
    /** The chain standing in the document, outermost layout first and the page last. */
    levels: Level[]
    /**
     * The chain the address resolved to.
     *
     * A kept layout's `<slot/>` mounts from it whenever its region opens — read at that moment
     * rather than captured when the layout mounted, or a slot reopened after a navigation put back
     * the page the reader had left.
     */
    chain: PageModule[]
    /**
     * The path the standing chain was mounted for: a step to it that moves only the query or the
     * fragment keeps the page (30.23, 30.24).
     */
    mounted: string | undefined
    /**
     * The route the standing page was matched by.
     *
     * 30.23 — an address it matches again keeps it.
     */
    standing: Compiled | undefined
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
    navigation: AbortController
    /**
     * 35.18 — whether the document is an error page's. Its markup is no page this router has, so
     * nothing hydrates over it, and leaving it is a document load.
     */
    errorPage: boolean
    /** The place in this document's history of the entry the address bar stands at (`Entry`). */
    index: number
    /**
     * 30.29 — the scroll each entry was left at, by its `index`.
     *
     * HELD HERE AS WELL AS IN `history.state`, because a back or forward step has already moved the
     * bar when `popstate` arrives, so the entry it left can no longer be written to.
     */
    scrolls: (Scroll | undefined)[]
    /**
     * The routes whose chunks `prefetch` has already asked for.
     *
     * `pointerover` bubbles, so a pointer crossing a link's children asks again at every edge, and
     * after the first time the answer is the module cache's anyway.
     */
    prefetched: Set<Compiled>
    /**
     * Whether a navigation's write is a view transition, as the build read it (39.7, 39.8).
     *
     * Read off the compiled `<style>` blocks. Nothing here looks at the document's stylesheets.
     */
    transitions: boolean

    constructor(region: Region, routes: Compiled[], transitions: boolean) {
        this.region = region
        this.routes = routes
        this.levels = []
        this.chain = []
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
    }

    /**
     * The route and params an address matches, or `undefined` for one this app has no route for.
     *
     * 16.10 — AN ADDRESS OUTSIDE THE MOUNT IS NO ROUTE OF THIS APP'S, and one inside it is matched
     * as the address below the app's root. Every way in — a click, an intent, back and forward, a
     * hydration — is matched here.
     */
    match(pathname: string): Found | undefined {
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
    async go(
        url: URL | string,
        options: NavigateOptions = {},
        step: Step = PUSHED,
    ): Promise<void> {
        const target =
            typeof url === 'string' ? new URL(url, location.href) : url
        // A CROSS-ORIGIN ADDRESS IS NOT A ROUTE. Handing it to `pushState` throws, and treating
        // it as a miss would leave the caller with a navigation that silently did nothing.
        if (target.origin !== location.origin || this.errorPage) {
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
        // 30.21, 30.23, 30.24 — THE ROUTE STANDING, AT ITS OWN PATH: another query, another fragment or
        // the same address. The page reads its address through `route`, so it follows rather than
        // being rebuilt, and there is no path for `middleware` to decide anything new about.
        if (found.route === this.standing && this.mounted === target.pathname) {
            this.follow(target, options, found, step)
            return
        }
        const ticket = this.supersede()
        route.navigating.set(true)
        // EVERY WAY OUT CLEARS WHAT THE WAY IN SET: a load that fails, a setup that throws and a
        // navigation that completes all leave `navigating` false and every layer closed. A
        // superseded one leaves `navigating` to the navigation that superseded it.
        try {
            // 30.15 — THE SERVER IS ASKED ALONGSIDE THE LOAD, so its `middleware` decides the
            // navigation for the price of the one round trip the chunks already cost.
            const [answer, loaded] = await Promise.all([
                ask(target, ticket.signal),
                loadOrMiss(found.route),
            ])
            // SUPERSEDED, so this navigation is over. Nothing has been touched yet, which is the
            // whole reason the ticket is checked here rather than after the mount — and
            // `navigating` stays the newer navigation's to clear.
            if (ticket.signal.aborted) return
            // 30.32 — OFFLINE, THE DOCUMENT LOAD BELOW CAN ONLY PAINT THE BROWSER'S ERROR PAGE over a
            // page that works. A history step has already moved the bar, so it is left to the
            // document.
            if (
                answer === undefined &&
                !navigator.onLine &&
                step.direction === 'push'
            ) {
                // 45.12 — UNLESS THE SERVICE WORKER SAVED THE PAGE, which the document load is
                // then answered with.
                if ((await savedOffline(target)) && !ticket.signal.aborted)
                    location.href = target.href
                return
            }
            // 30.18 — A REFUSAL, A RESPONSE MIDDLEWARE ANSWERED ITSELF, or no answer at all: the
            // document asks again and paints whatever the server says. A fetch that failed —
            // offline, or a redirect to another origin that CORS will not let it follow — goes to
            // the address it was sent to.
            // 30.27 — AND CHUNKS THAT WOULD NOT LOAD, with the server down or a deploy that removed
            // them: a rejection here was dropped by the click's `void`, and the link did nothing.
            if (answer?.status !== 204 || loaded === undefined) {
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
            // 30.23 — THE ROUTE STANDING, AT ANOTHER PATH: `middleware` has said yes to the path, and
            // the page it matched is the one already mounted, so it follows.
            if (landing.route === this.standing) {
                this.follow(landed, options, landing, step)
                return
            }
            const arriving =
                landing === found ? loaded : await loadOrMiss(landing.route)
            if (ticket.signal.aborted) return
            if (arriving === undefined) {
                location.href = landed.href
                return
            }
            await this.write(ticket, step.direction, () =>
                this.commit(landed, landing, arriving, options, step),
            )
        } finally {
            if (this.navigation === ticket) route.navigating.set(false)
        }
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
        found: Found,
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
        arrive(target.href, found.route.pattern, found.params)
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
    stepped(): Step {
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
        if (replace) {
            history.replaceState(entryAt(this.index, null), '', full)
            return
        }
        this.remember(left)
        this.index += 1
        this.scrolls.length = this.index
        history.pushState(entryAt(this.index, null), '', full)
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
        found: Found,
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
            // 41.11 — WHAT THE TWO ADDRESSES SHARE IS NOT REBUILT. The comparison is by the MOUNT
            // rather than by the loader or the module record: the table holds an arrow per row, so
            // two routes under one layout name the same file through two different functions, and a
            // table written by hand may answer with a fresh record each call. The function a module
            // exports is the same function either way.
            const shared = this.sharedLevels(arriving)
            // READ BEFORE THE STOP, while the leaving levels' heads read what they read on screen.
            const leaving = Level.headsOf(
                this.levels,
                shared,
                this.levels.length,
            )
            const left: Scroll = [scrollX, scrollY]
            this.stopFrom(shared)
            // The region the arriving part goes into: the page region where nothing is kept, and
            // the deepest kept layout's own slot where something is.
            //
            // NOWHERE, where that slot's region is closed: the arriving part is mounted by the slot
            // when it opens, off `chain`, and not into a region no longer in the document.
            const into =
                shared === 0
                    ? this.region
                    : (this.levels[shared - 1] as Level).slot
            // EMPTIED THROUGH THE PRIMITIVE EVERY OTHER REGION IS. `fillRegion(region)` with no
            // build is this removal, and it carries the 41.10 refusal for a region no longer in a
            // document that a hand-written walk swallows.
            if (into !== undefined) fillRegion(into)
            this.writeAddress(target, options.replace === true, left)
            // 39.6 — each arriving level applies its own head as it mounts into its emptied region,
            // outermost first; a kept layout is not mounted again, so neither is its head.
            this.mountChain(target, found, arriving, shared, into)
            // 39.14 — what the leaving levels keyed and the arriving ones did not goes back to the
            // nearest kept layout's, else leaves.
            withdrawHead(leaving, () => [
                Level.headsOf(this.levels, 0, shared),
                Level.headsOf(this.levels, shared, this.levels.length),
            ])
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
     * How many levels of the arriving chain are already standing.
     *
     * Layouts only: a page reached here is another route's, the same route's being followed instead
     * (30.23).
     *
     * EVERY STANDING LEVEL IS COMPARED, the page included: a page is never a layout, so it cannot
     * match one, and a layout whose slot is closed stands with nothing below it.
     */
    private sharedLevels(arriving: PageModule[]): number {
        const layouts = arriving.length - 1
        let shared = 0
        while (
            shared < layouts &&
            shared < this.levels.length &&
            (this.chain[shared] as PageModule).default ===
                (arriving[shared] as PageModule).default
        )
            shared += 1
        return shared
    }

    /**
     * Stops every level from `at` down, inside out, and drops them.
     *
     * Stopped from the INSIDE OUT, so a layout's disposers run after the page's — the order a
     * scope's own teardown already has, and the one an author reading two `watch` cleanups in
     * two files would expect.
     */
    private stopFrom(at: number): void {
        for (let index = this.levels.length - 1; index >= at; index -= 1) {
            const level = this.levels[index] as Level
            // The level's head leaves whole, so none of its components withdraws its own.
            level.contributed.clear()
            level.scope?.stop()
        }
        this.levels.length = at
    }

    /**
     * Mounts the chain from level `at` into `region`, each level handed the next as `children`.
     *
     * 35.1 — each level is handed the one below it as `children` (32.18), so a layout puts the page
     * in its `<slot/>` with the same mechanism a caller writing markup between two tags uses — and
     * the router learns where that slot is on the way past, which is what lets it swap the page
     * there later without the layout knowing.
     *
     * THE CHILD'S SCOPE IS THE ROUTER'S, not the layout's, so a kept layout cannot stop the page
     * arriving under it. What `mount` hands the layout is a stop for WHATEVER STANDS IN THE SLOT
     * when the slot's region leaves — a `<slot/>` inside a closed `{#if}` — rather than for the
     * page that happened to be mounted first. And the slot mounts from `chain`, so a slot that
     * opens again mounts the page the address resolves to now.
     */
    private mountFrom(at: number, region: Region): void {
        setUpLevels(
            at,
            this.chain.length,
            this.levels[at - 1]?.share,
            ROUTE_PROPS,
            (below, props) => this.setUp(below, region, props),
        )
        this.markUp(at, region)
    }

    /**
     * Runs level `at`'s setup over `props`, leaving its markup on the level for `markUp`, and
     * answers the share scope the setup left.
     */
    private setUp(
        at: number,
        region: Region,
        props: Record<string, (() => unknown) | undefined>,
    ): ShareScope | null {
        const module = this.chain[at] as PageModule
        const level = new Level(this.levels, at)
        this.levels[at] = level
        if (at < this.chain.length - 1)
            props.children = () => ({
                // NO BUILD, because the level below carries its own (32.17): a module a route
                // reaches fills the region it is mounted against when that region is empty, so
                // the build and the mount are one call rather than two.
                build: undefined,
                mount: (slot: Region): Stoppable => {
                    // The level below as `mountFrom` set it up, the first time its slot opens; a
                    // slot opening again sets it up afresh.
                    const pending = this.levels[at + 1]?.markup !== undefined
                    if (!pending) this.release(level, at)
                    level.slot = slot
                    if (pending) this.markUp(at + 1, slot)
                    else this.mountFrom(at + 1, slot)
                    return { stop: () => this.release(level, at) }
                },
            })
        // The region a level's markup lands in is its slot above, known only once that markup
        // runs; a module mounted by the router leaves its markup rather than using this one.
        // A deferred level answers the scope its setup made, so the watches that setup opened are
        // stopped with the level even where its markup never runs — a slot that never opens.
        level.scope = level.mount(() => module.default(region, props, level))
        return level.share
    }

    /** Runs the markup level `at`'s setup left, into `region`. */
    private markUp(at: number, region: Region): void {
        const level = this.levels[at] as Level
        const markup = level.markup
        if (markup === undefined) return
        level.markup = undefined
        level.scope = level.mount(() => markup(region))
    }

    /**
     * Stops what stands below `level` and forgets its slot.
     *
     * A no-op once the level itself has been replaced, which is how a stop handed to a layout that
     * has since left does nothing.
     */
    private release(level: Level, at: number): void {
        if (this.levels[at] !== level) return
        level.slot = undefined
        this.stopFrom(at + 1)
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
        this.mountChain(new URL(location.href), found, standing, 0, this.region)
        // 30.30 — A RELOAD lands on an entry that carries the scroll `remember` wrote on the way out.
        const scroll = (history.state as Partial<Entry> | null)?.scroll
        if (scroll != null) scrollTo(scroll[0], scroll[1])
    }

    /**
     * Records the arriving chain as standing and mounts it from level `from` into `into`.
     *
     * AT THE TOP OF THE CHAIN, NOT INSIDE `mountFrom`: it recurses one level per layout, and
     * `shares()` SUMS every measure of a name inside the op — so a pair inside the recursion would
     * count the innermost level once per level above it. 23.1 — WRITTEN BEFORE THE ARRIVING PAGE'S
     * SETUP, which reads it.
     */
    private mountChain(
        target: URL,
        found: Found,
        modules: PageModule[],
        from: number,
        into: Region | undefined,
    ): void {
        arrive(target.href, found.route.pattern, found.params)
        this.chain = modules
        this.standing = found.route
        this.mounted = target.pathname
        if (into === undefined) return
        beginLayer(LAYER_MOUNT)
        try {
            this.mountFrom(from, into)
        } finally {
            endLayer(LAYER_MOUNT)
        }
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

/**
 * The props a routed page or layout is set up over, `children` aside: `params` as a live accessor.
 *
 * 33.4 — A PROP IS AN ACCESSOR. A page is mounted as any other component is, so its one prop is
 * passed the way `renderComponent` passes a child's and the way `answerRequest` paints one: a
 * function per key. Passed as the plain record it lowered to `params()` on a value that was not
 * one, so every page with a `[param]` in its address hydrated dead — with its server markup
 * already on screen, which is what kept it quiet.
 *
 * 33.5 — AND A LIVE ONE: `params` reads `route.params`, which every navigation writes. A layout
 * kept across `/users/1` -> `/users/2` is not mounted again, so an accessor over the params it was
 * mounted with went on answering user 1.
 */
const ROUTE_PROPS = { params: (): Params => route.params() }

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
