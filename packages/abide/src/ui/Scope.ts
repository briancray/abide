import {
    type Disposer,
    type Effect,
    rerunWatch,
    watchTracked,
} from '#shared/reactive/watch.ts'

/** What a scope built under a `{#try}` binds through — its `TryRegion` (32.16). */
type Boundary = {
    guard<T>(run: () => T, again: () => unknown): T | undefined
}

/** The boundary a scope built now falls under, or `undefined` outside every `{#try}` body. */
export const BOUNDARY: { current: Boundary | undefined } = {
    current: undefined,
}

/**
 * Anything a scope can stop below itself.
 *
 * Another `Scope` — an arm's, a row's, an invoked component's — or a `{#for}`'s `List`, which stops
 * every row it still holds. Structural rather than a base class: `List` is a record in another
 * module and `stop` is all the two share.
 */
export type Stoppable = { stop(): void }

/**
 * The bindings a region opens, held so whatever replaces the region can stop them.
 *
 * Without it a swap or a removed row leaves the old readers alive: they wake on every write, write
 * into nodes that are no longer in the document, and the page looks right while doing the work
 * twice over.
 *
 * A RECORD RATHER THAN A CLOSURE PER ROW: one object with methods on its prototype, where closures
 * cost an array and three allocations a row — the collector, the stop and the stop it handed back.
 */
export class Scope {
    /**
     * 12.4, 12.13 — a setup's watches land here as it opens them (`collectWatches`): the scope is
     * made before the setup runs, so a watch has one owner from the moment it opens.
     */
    stops: Disposer[] = []
    /**
     * The scopes opened beneath this one, or `undefined` until one is.
     *
     * 12.4 and 12.13 — a region's own disposers are not all it owns: an arm, a row and an invoked
     * component each open a scope of their own, and the thing that knows when those leave is the
     * region holding their nodes. `undefined` until one is actually opened — most scopes hold only
     * disposers, and a second array a row is the allocation this class exists not to spend.
     */
    children: Stoppable[] | undefined = undefined
    /**
     * The `{#try}` this scope was built under, or `undefined`.
     *
     * 32.16 — read once at construction.
     */
    boundary: Boundary | undefined = BOUNDARY.current
    /**
     * 32.67 — where in `stops` a row's item watches start (`itemWatch`), and how many there are:
     * opened one after another by a row's mount, so two numbers find them and the row allocates
     * nothing to be found by.
     */
    itemsAt = 0
    items = 0

    watch(effect: Effect): void {
        const boundary = this.boundary
        if (boundary === undefined) {
            this.stops.push(watchTracked(effect))
            return
        }
        // UNDER A BOUNDARY, a throw is the boundary's and the scopes a rerun builds are too, and a
        // failed binding is retried by running it again.
        this.stops.push(watchTracked(() => boundary.guard(effect, effect)))
    }

    /**
     * A watch over a row's item, which reads it off the row's record until the row has a cell
     * (`itemOf`) — `rerunItems` reruns it when the row takes its first new item.
     *
     * A row's mount opens these one after another, so they stand together in `stops`.
     */
    itemWatch(effect: Effect): void {
        if (this.items === 0) this.itemsAt = this.stops.length
        this.items += 1
        this.watch(effect)
    }

    /** Reruns every `itemWatch`, each reading — and subscribing to — the row's cell this time. */
    rerunItems(): void {
        const stops = this.stops
        const end = this.itemsAt + this.items
        for (let index = this.itemsAt; index < end; index += 1)
            rerunWatch(stops[index] as Disposer)
    }

    /**
     * Takes ownership of a child scope or list; answers the child it was handed.
     *
     * 12.4 — A `watch` REGISTERED INSIDE A COMPONENT IS OWNED BY THAT COMPONENT, and what can
     * remove a component's nodes is the region that invoked it. The child is held rather than
     * drained: a component that itself holds an arm or a list owns scopes of its own, and moving
     * only its disposers out would leave those where nothing can reach them.
     *
     * `undefined` IS A STATIC CHILD — a component with nothing live returns nothing to own.
     */
    own<T extends Stoppable | undefined>(child: T): T {
        if (child === undefined) return child
        if (this.children === undefined) this.children = []
        this.children.push(child)
        return child
    }

    /**
     * Stops every binding and child this scope holds, and clears them.
     *
     * CLEARED AS IT GOES, so stopping twice is stopping once: an arm's scope is stopped by its own
     * swap and again by the region above it when that region leaves, and 12.1 gives a `Disposer`
     * one run at teardown rather than one per path that reaches it. It is also what lets a block
     * hold ONE scope for its whole life and refill it on every swap.
     *
     * `from` KEEPS THE SETUP'S: a mount that refused (41.10) stops what IT opened and rebuilds, and
     * the setup ahead of it — whose watches are the first `from` stops — does not run again.
     */
    stop(from = 0): void {
        const stops = this.stops
        for (let index = from; index < stops.length; index += 1)
            (stops[index] as Disposer)()
        stops.length = from
        if (from <= this.itemsAt) this.items = 0
        const children = this.children
        if (children === undefined) return
        for (const child of children) child.stop()
        children.length = 0
    }
}

/**
 * A shared scope with nothing in it; stopping it is a no-op.
 *
 * What a mount whose body binds nothing answers, and what a row holds until its mount returns —
 * `stop` on it is a no-op, so any number of owners can hold it.
 */
export const EMPTY_SCOPE = new Scope()
