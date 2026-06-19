import { probeRegistries } from './probeRegistries.ts'
import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheSelector } from './types/CacheSelector.ts'
import type { Subscribable } from './types/Subscribable.ts'

/*
Reactive revalidation probe over both registries. Refreshing means "holding a
value it already had while a fresher source is in flight":
  refreshing()              → anything reloading data it already had
  refreshing(fn)            → that function's calls (per-route "updating…" badge)
  refreshing(fn, args)      → exactly that call (per-row badge)
  refreshing({ tags })      → a tagged group
  refreshing(subscribable)  → that stream reconnecting with its last value
                              retained — never merely `open`; a live stream's
                              arriving frames are its normal mode, not a reload
On the cache side this covers a policy stale-while-revalidate refetch (settled,
value visible, fresh fetch in flight) and the default drop-then-reload (pending
is also true there). The distinction from pending(): pending answers "is there
no value yet?", refreshing answers "is a held value being superseded?".
Probes report, never act. Scan semantics (tap order, selector grammar,
registry spans) live in probeRegistries.
*/
// @readme probes
export function refreshing<Args, Return>(
    arg?: CacheSelector<Args, Return> | Subscribable<unknown>,
    args?: Args,
): boolean {
    return probeRegistries(arg, args, 'refreshing', reloading, false)
}

const reloading = (entry: CacheEntry) => entry.refreshing === true
