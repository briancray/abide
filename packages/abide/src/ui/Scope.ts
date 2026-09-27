import { type Disposer, type Effect, watch } from '#shared/reactive/watch.ts'
import { BOUNDARY, inBoundary, type TryBoundary } from './TryBoundary.ts'

// ANYTHING A SCOPE CAN STOP BELOW ITSELF: another `Scope` — an arm's, a row's, an invoked
// component's — or a `{#for}`'s `List`, which stops every row it still holds. Structural rather
// than a base class: `List` is a record in another module and `stop` is all the two share.
export type Stoppable = { stop(): void }

// EVERY BINDING A REGION OPENS, so what replaced it can be stopped. Without it a swap or a removed
// row leaves the old readers alive: they wake on every write, write into nodes that are no longer
// in the document, and the page looks right while doing the work twice over.
//
// A RECORD RATHER THAN A CLOSURE PER ROW: one object with methods on its prototype, where closures
// cost an array and three allocations a row — the collector, the stop and the stop it handed back.
export class Scope {
    stops: Disposer[] = []
    // 12.4 AND 12.13 — THE SCOPES OPENED BENEATH THIS ONE. A region's own disposers are not
    // all it owns: an arm, a row and an invoked component each open a scope of their own, and
    // the thing that knows when those leave is the region holding their nodes. `undefined` until
    // one is actually opened — most scopes hold only disposers, and a second array a row is the
    // allocation this class exists not to spend.
    children: Stoppable[] | undefined = undefined
    // 32.16 — the `{#try}` this scope was built under, read once at construction, or `undefined`.
    boundary: TryBoundary | undefined = BOUNDARY.current

    watch(effect: Effect): void {
        const boundary = this.boundary
        if (boundary === undefined) {
            this.stops.push(watch(effect))
            return
        }
        // UNDER A BOUNDARY, a throw is the boundary's and the scopes a re-run builds are too, and a
        // failed binding is retried by running it again.
        this.stops.push(watch(() => inBoundary(boundary, effect, effect)))
    }

    // 12.4 — A `watch` REGISTERED INSIDE A COMPONENT IS OWNED BY THAT COMPONENT, and what can
    // remove a component's nodes is the region that invoked it. The child is held rather than
    // drained: a component that itself holds an arm or a list owns scopes of its own, and moving
    // only its disposers out would leave those where nothing can reach them.
    //
    // `undefined` IS A STATIC CHILD — a component with nothing live returns nothing to own.
    own<T extends Stoppable | undefined>(child: T): T {
        if (child === undefined) return child
        if (this.children === undefined) this.children = []
        this.children.push(child)
        return child
    }

    // CLEARED AS IT GOES, so stopping twice is stopping once: an arm's scope is stopped by its own
    // swap and again by the region above it when that region leaves, and 12.1 gives a `Disposer`
    // one run at teardown rather than one per path that reaches it. It is also what lets a block
    // hold ONE scope for its whole life and refill it on every swap.
    stop(): void {
        const stops = this.stops
        for (const stop of stops) stop()
        stops.length = 0
        const children = this.children
        if (children === undefined) return
        for (const child of children) child.stop()
        children.length = 0
    }
}

// A SCOPE WITH NOTHING IN IT, shared. What a mount whose body binds nothing answers, and what a
// row holds until its mount returns — `stop` on it is a no-op, so any number of owners can hold it.
export const EMPTY_SCOPE = new Scope()
