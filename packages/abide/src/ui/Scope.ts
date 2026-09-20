import { type Disposer, type Effect, watch } from '#shared/reactive/watch.ts'

// EVERY BINDING A REGION OPENS, so what replaced it can be stopped. Without it a swap or a removed
// row leaves the old readers alive: they wake on every write, write into nodes that are no longer
// in the document, and the page looks right while doing the work twice over.
//
// A RECORD RATHER THAN A CLOSURE PER ROW: one object with two methods on its prototype, where
// closures cost an array and three allocations a row — the collector, the stop and the stop it
// handed back.
export class Scope {
    stops: Disposer[] = []

    watch(effect: Effect): void {
        this.stops.push(watch(effect))
    }

    // 32.19 — A CHILD'S BINDINGS BELONG TO WHOEVER CAN REMOVE ITS NODES. A component opens its
    // own scope inside its own mount, and the caller is the one that knows when the row or the arm
    // holding it leaves — so the child's stops are taken over rather than left where nothing can
    // reach them. The disposers are moved rather than wrapped: a closure per invocation per row is
    // the allocation this class exists to avoid.
    //
    // `undefined` IS A STATIC CHILD. A component with nothing to hydrate compiles to the no-op
    // module its caller still has to import (`bin/abide.ts`), and a no-op opens no scope — there
    // is nothing to stop, and making it allocate one per row to say so is a cost for a message.
    adopt(child: Scope | undefined): void {
        if (child === undefined) return
        const stops = child.stops
        for (let at = 0; at < stops.length; at += 1)
            this.stops.push(stops[at] as Disposer)
    }

    stop(): void {
        for (const stop of this.stops) stop()
    }
}
