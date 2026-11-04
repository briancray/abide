import type { Params } from '#shared/matchRoute.ts'
import type { ShareScope } from '#shared/reactive/share.ts'
import { route } from '#shared/route.ts'
import { setUpLevels } from '#shared/setUpLevels.ts'

import { LAYER_MOUNT } from './LAYER_NAMES.ts'
import { Level } from './Level.ts'
import { beginLayer, endLayer } from './measureLayer.ts'
import { fillRegion, type Region } from './regions.ts'
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

export type PageModule = { default: PageMount }

/**
 * The routed chain standing in the document — its layouts outermost first and the page last — and
 * the head they contribute (39.1, 39.14).
 *
 * 41.11 — THE CHAIN HOLDS ITS LEVELS rather than each level owning the one below it, which is what
 * makes a shared layout something a navigation can KEEP: a scope stopped from above takes its
 * children with it, and a layout that survives a navigation must not take the page it was holding.
 *
 * 39.14 — EVERY WAY A LEVEL LEAVES IS BRACKETED HERE: the head reconciled while the leaving levels
 * still read what is on screen, so what the server painted for them is adopted as theirs, and again
 * once they are gone — and a leaving level's contributions are cleared before its scope stops, or
 * each component's `HeadContribution.stop` would withdraw and reconcile on its own.
 */
export class LevelChain {
    /** The region the outermost level mounts into. */
    private readonly root: Region
    private readonly levels: Level[]
    /**
     * The modules the address resolved to, one per level.
     *
     * A kept layout's `<slot/>` mounts from it whenever its region opens — read at that moment
     * rather than captured when the layout mounted, or a slot reopened after a navigation put back
     * the page the reader had left.
     */
    private modules: PageModule[]

    constructor(root: Region) {
        this.root = root
        this.levels = []
        this.modules = []
    }

    /** How many levels stand. */
    get depth(): number {
        return this.levels.length
    }

    /** The scope of the level at `at` — negative counts from the page — or `undefined`. */
    scopeAt(at: number): Scope | undefined {
        return this.levels.at(at)?.scope
    }

    /** Reconciles the document head from every level standing (`Level.reconcile`). */
    reconcile(): void {
        Level.reconcile(this.levels)
    }

    /**
     * How many levels of `arriving` are already standing.
     *
     * Layouts only: a page reached here is another route's, the same route's being followed instead
     * (30.23). EVERY STANDING LEVEL IS COMPARED, the page included: a page is never a layout, so it
     * cannot match one, and a layout whose slot is closed stands with nothing below it.
     *
     * By the MOUNT rather than by the loader or the module record: the table holds an arrow per
     * row, so two routes under one layout name the same file through two different functions, and a
     * table written by hand may answer with a fresh record each call.
     */
    sharedWith(arriving: PageModule[]): number {
        const layouts = arriving.length - 1
        let shared = 0
        while (
            shared < layouts &&
            shared < this.levels.length &&
            (this.modules[shared] as PageModule).default ===
                (arriving[shared] as PageModule).default
        )
            shared += 1
        return shared
    }

    /**
     * Mounts `modules` from the top into the root region the server painted. No head is reconciled:
     * a painted level's mount hydrates, and the head is the one the server wrote.
     */
    hydrate(modules: PageModule[]): void {
        this.modules = modules
        this.mountMeasured(0, this.root)
    }

    /**
     * Keeps the first `kept` levels and mounts `modules` below them, reconciling the head around it.
     *
     * `between` runs once the leaving levels have stopped and their region is emptied, and before
     * the arriving ones are set up — the address written and `route` moved, which a setup reads.
     *
     * The arriving part goes into the root where nothing is kept, and into the deepest kept layout's
     * slot where something is — NOWHERE where that slot's region is closed: the slot mounts it off
     * `modules` when it opens, and not into a region no longer in the document.
     */
    replace(kept: number, modules: PageModule[], between: () => void): void {
        this.reconcile()
        this.stopFrom(kept)
        const into =
            kept === 0 ? this.root : (this.levels[kept - 1] as Level).slot
        // EMPTIED THROUGH THE PRIMITIVE EVERY OTHER REGION IS, which carries the 41.10 refusal for a
        // region no longer in a document that a hand-written walk swallows.
        if (into !== undefined) fillRegion(into)
        between()
        this.modules = modules
        // 39.6 — each arriving level applies its own head as it mounts into its emptied region; a
        // kept layout is not mounted again, so neither is its head.
        if (into !== undefined) this.mountMeasured(kept, into)
        // 39.14 — what the leaving levels keyed and the arriving ones did not goes back to the
        // nearest kept layout's, else leaves; their keyless nodes leave with them (39.16).
        this.reconcile()
    }

    /**
     * AT THE TOP OF THE CHAIN, NOT INSIDE `mountFrom`: it recurses one level per layout, and
     * `shares()` SUMS every measure of a name inside the op — so a pair inside the recursion would
     * count the innermost level once per level above it.
     */
    private mountMeasured(from: number, into: Region): void {
        beginLayer(LAYER_MOUNT)
        try {
            this.mountFrom(from, into)
        } finally {
            endLayer(LAYER_MOUNT)
        }
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
            // OUT OF THE CHAIN BEFORE IT STOPS, so a slot stop it fires on the way finds it gone
            // (`release`) and leaves the head to whoever stopped it.
            this.levels.length = index
            // The level's head leaves whole, so none of its components withdraws its own.
            level.contributed.clear()
            level.scope?.stop()
        }
    }

    /**
     * Mounts the chain from level `at` into `region`, each level handed the next as `children`.
     *
     * 35.1 — each level is handed the one below it as `children` (32.18), so a layout puts the page
     * in its `<slot/>` with the same mechanism a caller writing markup between two tags uses — and
     * the chain learns where that slot is on the way past, which is what lets it swap the page
     * there later without the layout knowing.
     *
     * THE CHILD'S SCOPE IS THE CHAIN'S, not the layout's, so a kept layout cannot stop the page
     * arriving under it. What `mount` hands the layout is a stop for WHATEVER STANDS IN THE SLOT
     * when the slot's region leaves — a `<slot/>` inside a closed `{#if}` — rather than for the
     * page that happened to be mounted first. And the slot mounts from `modules`, so a slot that
     * opens again mounts the page the address resolves to now.
     */
    private mountFrom(at: number, region: Region): void {
        setUpLevels(
            at,
            this.modules.length,
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
        const module = this.modules[at] as PageModule
        const level = new Level(this)
        this.levels[at] = level
        if (at < this.modules.length - 1)
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
        // runs; a module mounted by the chain leaves its markup rather than using this one.
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
        // 39.14, 39.16 — THE LEVELS BELOW LEAVE WITH THE SLOT'S REGION, and their head with them.
        this.reconcile()
        this.stopFrom(at + 1)
        this.reconcile()
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
