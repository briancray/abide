import { tailProbeSlot } from './tailProbeSlot.ts'
import type { NamedAsyncIterable } from './types/NamedAsyncIterable.ts'

/*
Reactive terminal-state reader for a stream: true once the source has closed (its
tail entry status === 'done'). Stream-only — a cache entry's "done" is just
`!pending && !refreshing`, so there is no cache-selector form. The residual bit the
`pending` / `refreshing` / `error` probes don't cover (see design Part 4). No prober
registered (server render, or tail never imported) reads as not-done.
*/
// @documentation probes
export function done(subscribable: NamedAsyncIterable<unknown>): boolean {
    /* Null-tolerant: a promise/iterable subexpression peek-lifts to `undefined` while
       pending (ADR-0032), so `done(getFeed())` in a template hands us `undefined` on the
       first pass — treat a missing source as not-done rather than throwing. */
    if (subscribable == null) {
        return false
    }
    return tailProbeSlot.probe?.(subscribable.name)?.done ?? false
}
