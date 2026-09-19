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

    stop(): void {
        for (const stop of this.stops) stop()
    }
}
