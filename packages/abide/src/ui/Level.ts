import {
    currentShare,
    leaveShare,
    resumeShare,
    type ShareScope,
} from '#shared/reactive/share.ts'
import { untracked } from '#shared/reactive/tracking.ts'
import { type Disposer, watchTracked } from '#shared/reactive/watch.ts'
import { applyHead, withdrawHead } from './applyHead.ts'
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
     * The head the components built on the client contributed while this level mounts, applied
     * once its `mount` returns; `undefined` outside one, where a contribution applies at once.
     */
    unapplied: string | undefined = undefined
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

    /** The level's head as it reads now: its own, then every component's, deepest last (39.4). */
    headMarkup(): string {
        let markup = this.head?.() ?? ''
        for (const one of this.contributed) markup += one.head()
        return markup
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
        // Batched while this level mounts; applied at once by an arm or a row mounted after it,
        // under whatever is deeper (39.4) — only the levels below, since it was added last here.
        const text = contribution.last ?? ''
        if (isEmptyRegion(region))
            if (this.unapplied !== undefined) this.unapplied += text
            else
                applyHead(
                    text,
                    untracked(Level.headsOf, this.levels, this.at + 1),
                )
        return contribution
    }

    /**
     * Writes `text` over the `last` that `contributor` in this level wrote.
     *
     * 39.4 — IT YIELDS TO EVERY CONTRIBUTOR DEEPER, read as they stand at the write and untracked:
     * the components that contributed after it, then every level below, so a layout's
     * `<title>{site}</title>` moving does not write over the page's `<title>`, and the page's head
     * moving wakes only the page's own watch. 39.15 — its keyless nodes replace the ones it wrote.
     */
    reapply(text: string, last: string, contributor: HeadContribution): void {
        applyHead(
            text,
            untracked(Level.headsAfter, this, contributor),
            last,
            // Read only where a key `last` held is withdrawn.
            () => untracked(Level.headsBefore, this, contributor),
        )
    }

    /**
     * The heads either side of `contribution` in `level` (`headsBefore`, `headsAfter`). One `level`
     * does not hold is the level's own head (`followHead`), which stands before every component's.
     */
    static headsAround(
        level: Level,
        contribution: HeadContribution,
    ): [string, string] {
        return [
            Level.headsBefore(level, contribution),
            Level.headsAfter(level, contribution),
        ]
    }

    /** Every level above `level`, then what stands before `contribution` in it. */
    static headsBefore(level: Level, contribution: HeadContribution): string {
        let outer = Level.headsOf(level.levels, 0, level.at)
        if (!level.contributed.has(contribution)) return outer
        outer += level.head?.() ?? ''
        for (const one of level.contributed) {
            if (one === contribution) break
            outer += one.head()
        }
        return outer
    }

    /** What stands after `contribution` in `level`, then every level below it. */
    static headsAfter(level: Level, contribution: HeadContribution): string {
        let inner = ''
        let past = !level.contributed.has(contribution)
        for (const one of level.contributed)
            if (past) inner += one.head()
            else if (one === contribution) past = true
        return inner + Level.headsOf(level.levels, level.at + 1)
    }

    /**
     * 39.13 — A HEAD THAT READS A VALUE FOLLOWS IT for as long as the level is mounted, which is
     * `scope`'s life. The first run only subscribes: the head it would write is already there,
     * written by the server or applied by the level's mount ahead of its fill (39.6). Followed as a
     * component's is, by a contribution the level does not hold (`headsAround`).
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
        this.unapplied = ''
        let unapplied: string
        let result: Result
        try {
            result = run()
        } finally {
            unapplied = this.unapplied
            this.unapplied = undefined
            leaveShare(back)
        }
        // 39.4 — under whatever a level below wrote while this one was mounting: the page in a
        // layout's `<slot/>` applied its own head ahead of the components that layout holds.
        if (unapplied !== '')
            applyHead(unapplied, Level.headsOf(this.levels, this.at + 1))
        return result
    }

    /** The heads of `levels` from `from` to `to`, outermost first. */
    static headsOf(levels: Level[], from: number, to = levels.length): string {
        let markup = ''
        for (let at = from; at < to; at += 1)
            markup += (levels[at] as Level).headMarkup()
        return markup
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
        if (last !== undefined && text !== last)
            this.level.reapply(text, last, this)
        this.last = text
    }

    /**
     * 39.14 — WITHDRAWN AS A LEAVING LEVEL'S IS, its keys going back to what stands outside it and
     * staying where something deeper holds them. Nothing where the level is leaving too: the router
     * withdraws the whole level once, and cleared its contributions before stopping it.
     */
    stop(): void {
        this.dispose?.()
        const level = this.level
        if (!level.contributed.has(this)) return
        withdrawHead(this.last ?? '', () =>
            untracked(Level.headsAround, level, this),
        )
        level.contributed.delete(this)
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
