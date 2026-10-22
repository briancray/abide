import {
    currentShare,
    leaveShare,
    resumeShare,
    type ShareScope,
} from '#shared/reactive/share.ts'
import { untracked } from '#shared/reactive/tracking.ts'
import { type Disposer, watchTracked } from '#shared/reactive/watch.ts'
import { reconciled, reconcileHead } from './reconcileHead.ts'
import { isEmptyRegion, type Region } from './regions.ts'
import type { Scope } from './Scope.ts'

/**
 * ONE LEVEL OF A ROUTED CHAIN — a layout or the page — and the head it contributes (39.1, 39.14).
 *
 * 41.11 — the router holds these rather than letting each level own the one below it, which is
 * what makes a shared layout something it can KEEP: a scope stopped from above takes its children
 * with it, and a layout that survives a navigation must not take the page it was holding a moment
 * ago. The module standing here is the router's `chain` at the same index.
 *
 * ON EVERY PAGE'S STATIC CLOSURE, because `contributeHead` is on the runtime barrel — so it knows
 * nothing of the router, and the router knows it only through `levels`.
 */
export class Level {
    /** The chain this level stands in, and where: a live head yields to every level below it. */
    levels: Level[]
    at: number
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
     * Whether a component built on the client contributed a head while this level mounts, which is
     * reconciled once its `mount` returns; `undefined` outside one, where it is reconciled at once.
     */
    unapplied: boolean | undefined = undefined
    /**
     * This level's own head markup as it reads now; `undefined` for a level with no `<head>`.
     *
     * 39.14 — READ WHEN THE LEVEL LEAVES OR STAYS ABOVE ONE THAT DOES, which is why it is the
     * markup's thunk and not the markup: a layout's `<title>{name}</title>` puts back the name it
     * reads at that moment.
     */
    head: (() => string) | undefined = undefined
    /**
     * The heads of the components mounted in this level, after its own and in the order they
     * mounted. A COLLECTION, NOT A CLOSURE PER CONTRIBUTION: a `{#for}` of components with a
     * `<head>` contributes once a row, and a chain of closures is read through as deep a stack. A
     * `Set`, so a row leaving with its region (39.14, 39.16) is withdrawn without a walk of the rest.
     */
    contributed = new Set<HeadContribution>()

    constructor(levels: Level[], at: number) {
        this.levels = levels
        this.at = at
    }

    /** Left by the level's mount (`emitClient`), painted or not. */
    setHead(head: () => string): void {
        this.head = head
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
        Level.reconcile(this.levels)
    }

    /**
     * Reconciles the document head from `levels`: each level's own head, then every component's in
     * the order they mounted, outermost first — so the deepest wins by key (39.4). Read untracked:
     * a head read here is followed by its own watch, not by whatever wrote.
     */
    static reconcile(levels: Level[]): void {
        reconcileHead(untracked(Level.chain, levels, undefined))
    }

    /** Every contributor in `levels` and the head it reads now, outermost first. */
    static chain(
        levels: Level[],
        _?: undefined,
    ): [who: object, text: string][] {
        const chain: [object, string][] = []
        for (const level of levels) {
            if (level.head !== undefined) chain.push([level, level.head()])
            for (const one of level.contributed) chain.push([one, one.head()])
        }
        return chain
    }

    /**
     * Joins a component's `<head>` to this level's. Applied once the level is mounted where the
     * component builds its own markup; a region the server painted already carries the head the
     * server wrote. It follows what it reads from here (39.13): A WATCH WHETHER OR NOT IT READS
     * ANYTHING THAT MOVES, one per component carrying a `<head>`, where a flag would be a second
     * path through here and an argument in every component that has one.
     */
    contribute(region: Region, head: () => string): HeadContribution {
        const contribution = new HeadContribution(this, head)
        this.contributed.add(contribution)
        contribution.dispose = watchTracked(() => contribution.follow())
        // Batched while this level mounts; reconciled at once for an arm or a row mounted after it.
        if (isEmptyRegion(region))
            if (this.unapplied !== undefined) this.unapplied = true
            else this.reconcile()
        return contribution
    }

    /**
     * 39.13 — A HEAD THAT READS A VALUE FOLLOWS IT for as long as the level is mounted, which is
     * `scope`'s life. The first run only subscribes: the head it would write is already there,
     * written by the server or applied by the level's mount ahead of its fill (39.6). Followed as a
     * component's is, by a contribution the level does not hold.
     */
    followHead(scope: Scope): void {
        const own = new HeadContribution(this, this.head as () => string)
        scope.watch(() => own.follow())
    }

    /**
     * Runs `run` with this the level components add their `<head>` to (39.1) — and applies what
     * those built on the client contributed once it returns, rather than once a component.
     */
    mount<Result>(run: () => Result): Result {
        // 39.1 — THE LEVEL RIDES THE SHARE SCOPE, so a component finds it as it finds a shared key,
        // whether it mounts now or in an arm or a row after (`contributeHead`).
        const back = resumeShare({
            parent: currentShare(),
            values: new Map(),
            level: this,
        })
        this.unapplied = false
        let unapplied: boolean
        let result: Result
        try {
            result = run()
        } finally {
            unapplied = this.unapplied
            this.unapplied = undefined
            leaveShare(back)
        }
        if (unapplied) this.reconcile()
        return result
    }
}

/**
 * One component's `<head>` in its level — what the component's scope owns, so the head leaves with
 * the component's region (39.14, 39.16).
 */
export class HeadContribution {
    level: Level
    head: () => string
    /** What this contribution last wrote, or `undefined` before its first run. */
    last: string | undefined = undefined
    dispose: Disposer | undefined = undefined

    constructor(level: Level, head: () => string) {
        this.level = level
        this.head = head
    }

    /** 39.13 — the first run only subscribes, as a level's own does. */
    follow(): void {
        const text = this.head()
        const last = this.last
        this.last = text
        if (last !== undefined && text !== last) this.level.reconcile()
    }

    /**
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
        level.reconcile()
    }
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
