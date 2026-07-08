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
    return tailProbeSlot.probe?.(subscribable.name)?.done ?? false
}
