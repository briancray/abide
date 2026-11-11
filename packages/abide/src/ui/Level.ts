import { type Reactive, reactive } from '#shared/reactive/index.ts'
import {
    currentShare,
    enterShare,
    leaveShare,
    type ShareScope,
} from '#shared/reactive/share.ts'
import { untracked } from '#shared/reactive/tracking.ts'
import {
    type Disposer,
    reportThrow,
    unowned,
    watchTracked,
} from '#shared/reactive/watch.ts'

import { reconciled, reconcileHead, unpainted } from './reconcileHead.ts'
import { isEmptyRegion, type Region } from './regions.ts'
import type { Scope } from './Scope.ts'

/** The chain a level stands in, known only as what reconciles the head — see `Level`. */
type HeadChain = { reconcile(): void }

/**
 * ONE LEVEL OF A ROUTED CHAIN — a layout or the page — and the head it contributes (39.1, 39.14).
 *
 * 41.11 — a `LevelChain` holds these rather than letting each level own the one below it.
 *
 * ON EVERY PAGE'S STATIC CLOSURE, because `contributeHead` is on the runtime barrel — so it knows
 * the chain it stands in only as what reconciles the head, and nothing of the router.
 */
export class Level {
    /** The chain this level stands in: a live head yields to every level below it. */
    chain: HeadChain
    scope: Scope | undefined = undefined
    /**
     * Where this level's `<slot/>` is, learned when the level below it mounted there, and
     * `undefined` again once that region leaves — a `<slot/>` inside a closed `{#if}` is nowhere.
     */
    slot: Region | undefined = undefined
    /**
     * 41.19 — this level's markup, left by its mount once its setup has run, for the router to run
     * once every level below has been set up too; `undefined` once it has run, or where the module
     * has none.
     */
    markup: ((region: Region) => Scope | undefined) | undefined = undefined
    /**
     * 10.5 — the share scope this level's setup ran in, for the level below to be set up inside.
     * `null` where the module left none.
     */
    share: ShareScope | null = null
    /**
     * This level's own head, the first contributor in it; `undefined` for a level with no `<head>`.
     *
     * 39.14 — READ WHEN THE LEVEL LEAVES OR STAYS ABOVE ONE THAT DOES, which is why it holds the
     * markup's thunk and not the markup: a layout's `<title>{name}</title>` puts back the name it
     * reads at that moment.
     */
    own: HeadContribution | undefined = undefined
    /**
     * The heads of the components mounted in this level, after its own and in the order they
     * mounted. A COLLECTION, NOT A CLOSURE PER CONTRIBUTION: a `{#for}` of components with a
     * `<head>` contributes once a row, and a chain of closures is read through as deep a stack. A
     * `Set`, so a row leaving with its region (39.14, 39.16) is withdrawn without a walk of the rest.
     */
    contributed = new Set<HeadContribution>()

    constructor(chain: HeadChain) {
        this.chain = chain
    }

    /** Left by the level's mount (`emitClient`), painted or not. */
    setHead(head: () => string): void {
        this.own = new HeadContribution(this, head)
    }

    /** Left by the level's mount for the router to run once the chain is set up (41.19). */
    leaveMarkup(
        markup: (region: Region) => Scope | undefined,
        share: ShareScope | null,
    ): void {
        this.markup = markup
        this.share = share
    }

    /** Reconciles the document head from the chain this level stands in (`reconcileHead`). */
    reconcile(): void {
        this.chain.reconcile()
    }

    /**
     * Reconciles the document head from `levels`: each level's own head, then every component's in
     * the order they mounted, outermost first — so the deepest wins by key (39.4). Read untracked:
     * a head read here is followed by its own watch, not by whatever wrote.
     */
    static reconcile(levels: Level[]): void {
        reconcileHead(untracked(Level.contributors, levels, undefined))
    }

    /** Every contributor in `levels` and the head it reads now, outermost first. */
    static contributors(
        levels: Level[],
        _?: undefined,
    ): [who: object, text: string][] {
        const chain: [object, string][] = []
        for (const level of levels) {
            const own = level.own
            if (own !== undefined) chain.push([own, own.read()])
            for (const one of level.contributed) chain.push([one, one.read()])
        }
        return chain
    }

    /**
     * Joins a component's `<head>` to this level's. Applied at the end of the turn where the
     * component builds its own markup; a region the server painted already carries the head the
     * server wrote. It follows what it reads from here (39.13): A WATCH WHETHER OR NOT IT READS
     * ANYTHING THAT MOVES, one per component carrying a `<head>`, where a flag would be a second
     * path through here and an argument in every component that has one.
     */
    contribute(region: Region, head: () => string): HeadContribution {
        const contribution = new HeadContribution(this, head)
        this.contributed.add(contribution)
        contribution.dispose = watchTracked(() => contribution.follow())
        // Batched with the rest of its turn, whether it joins as the level mounts or in an arm or a row
        // after — a route change reconciles at once after its mount anyway (`LevelChain.replace`).
        if (isEmptyRegion(region)) {
            unpainted(contribution)
            reconcileLater(this.chain)
        }
        return contribution
    }

    /**
     * 39.13 — A HEAD THAT READS A VALUE FOLLOWS IT for as long as the level is mounted, which is
     * `scope`'s life. On a painted level the first run only subscribes — the head it would write is
     * already there — and seeds what it stands as if its head throws before anything has reconciled
     * it (39.20). On a mounted one the mount's reconcile has read it already (39.6), so the first run
     * asks for another only where the fill moved what the head reads.
     */
    followHead(scope: Scope): void {
        const own = this.own as HeadContribution
        scope.watch(() => own.follow())
    }

    /** Runs `run` with this the level components add their `<head>` to (39.1). */
    mount<Result>(run: () => Result): Result {
        // 39.1 — THE LEVEL RIDES THE SHARE SCOPE, so a component finds it as it finds a shared key,
        // whether it mounts now or in an arm or a row after (`contributeHead`).
        const back = enterShare(this)
        try {
            return run()
        } finally {
            leaveShare(back)
        }
    }
}

/**
 * One contributor's `<head>` in its level: a component's, which the component's scope owns so the
 * head leaves with its region (39.14, 39.16), or the level's own (`Level.own`), which leaves with
 * the level.
 */
export class HeadContribution {
    level: Level
    head: () => string
    /** What this head last read, or `undefined` before it first was. */
    last: string | undefined = undefined
    dispose: Disposer | undefined = undefined

    constructor(level: Level, head: () => string) {
        this.level = level
        this.head = head
    }

    /**
     * 39.13 — the first run only subscribes. 39.20 — read through `read`, so a throw here is reported
     * once and stands as what it last read, which asks no reconcile.
     */
    follow(): void {
        const last = this.last
        if (this.read() !== last && last !== undefined)
            reconcileLater(this.level.chain)
    }

    /** This head as it reads now, or as it last did once it has thrown (39.20). */
    read(): string {
        try {
            this.last = this.head()
        } catch (thrown) {
            const kept = this.last ?? ''
            this.head = headThrew(thrown, kept)
            this.last = kept
        }
        return this.last
    }

    /**
     * A COMPONENT'S ONLY: a level's own leaves with the level, never through here.
     *
     * 39.14 — WITHDRAWN AS A LEAVING LEVEL'S IS: the chain is reconciled without it. Adopted first
     * where the server painted it and nothing has reconciled since, so what it painted is known to
     * be its own. Nothing where the level is leaving too: the router reconciles the whole chain
     * once, and cleared its contributions before stopping it.
     */
    stop(): void {
        this.dispose?.()
        const level = this.level
        if (!level.contributed.has(this)) return
        if (!reconciled(this)) level.reconcile()
        level.contributed.delete(this)
        reconcileLater(level.chain)
    }
}

/**
 * 39.20 — A HEAD THAT THROWS STANDS AS IT LAST READ, reported once (12.6) and never read again: a
 * throw out of a reconcile would leave every one after it throwing too — a navigation's, a
 * stopping component's half way through its scope's siblings — for as long as the contributor
 * stays mounted. Returns what the head is read as from here.
 */
function headThrew(thrown: unknown, kept: string): () => string {
    reportThrow(
        thrown,
        'a <head> threw, and stands as it last read. RULEBOOK 39.20.',
    )
    return () => kept
}

/** The chains a contributor asked to reconcile since the head last was, each once. */
const STALE = new Set<HeadChain>()
/** Moved to wake the one watch that reconciles `STALE`; both opened by the first ask. */
let asked: Reactive<number> | undefined

/**
 * Reconciles `chain`'s head at the end of this turn's drain — ONCE A TURN, NOT ONCE A CONTRIBUTOR.
 * A `{#for}` grown by N rows that each carry a `<head>` joins N contributors in one effect, and a
 * reconcile walks every contributor the chain holds, so one per row is N² — measured in chromium
 * past a frame at ~400 rows of a keyless `<style>` and ~600 of a keyed `<link>`. A WATCH RATHER THAN A MICROTASK: a contribution made inside an
 * effect is written in that same drain, and `flushSync` ends the turn for this as for every effect.
 */
function reconcileLater(chain: HeadChain): void {
    let version = asked
    if (version === undefined) {
        // UNOWNED: whichever component asks first, the watch outlives it.
        const opened = unowned(() => reactive(0))
        watchTracked(() => {
            opened()
            const chains = [...STALE]
            STALE.clear()
            for (const chain of chains) chain.reconcile()
        })
        version = asked = opened
    }
    if (STALE.size === 0) version.set((version.peek() as number) + 1)
    STALE.add(chain)
}

/**
 * A component's `<head>`, added to the page or layout it stands in (39.1) — found through the share
 * scope the component runs in, so an arm or a row mounted after its level finds it as its first
 * mount did (39.13).
 *
 * Joined to that level's head, so it is withdrawn as the level's is when it leaves (39.14), and
 * deeper than the level's own, so it wins by key (39.4). Nothing outside a routed level.
 */
export function contributeHead(
    region: Region,
    head: () => string,
): HeadContribution | undefined {
    return (currentShare()?.level as Level | undefined)?.contribute(
        region,
        head,
    )
}
