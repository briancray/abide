import { probeRegistries } from './probeRegistries.ts'
import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheSelector } from './types/CacheSelector.ts'
import type { Subscribable } from './types/Subscribable.ts'

/*
Reactive in-flight probe over both registries — the cache (calls) and the
tail registry (streams). Pending means "no value yet":
  pending()              → any call in flight, or any registered stream
                           awaiting its first frame (global activity bar)
  pending(fn)            → that function's calls (per-route spinner; remote or
                           producer, same selector grammar as cache.invalidate)
  pending(fn, args)      → exactly that call (per-row spinner)
  pending({ tags })      → a tagged group
  pending(subscribable)  → that stream awaiting its first frame
                           (tail.status === 'pending'; true when nothing
                           is reading yet — there is no value either way)
Probes report, never act: reading one opens no fetch and no stream. SSR
loading state is driven by {#await}, not this. Scan semantics (tap order,
selector grammar, registry spans) live in probeRegistries.
*/
// @documentation probes
export function pending<Args, Return>(
    arg?: CacheSelector<Args, Return> | Subscribable<unknown>,
    args?: Args,
): boolean {
    return probeRegistries(arg, args, 'pending', unsettled, true) || durableQueued(arg, args)
}

const unsettled = (entry: CacheEntry) => entry.settled !== true

/*
A durable (`outbox: true`) rpc carries an `.outbox()` face listing its undelivered
entries (queued or sending). Those count as pending too — so `disabled={pending(rpc)}`
guards a form against a double-submit while offline, not just while a fetch is in flight.
The selector carries its own face, so no client-only registry import is needed (shared
stays isomorphic; server-side there is no face and this is a no-op). `pending(rpc, args)`
narrows to a matching queued call via a structural args compare.
*/
function durableQueued(arg: unknown, args: unknown): boolean {
    const outbox = (arg as { outbox?: () => { args: unknown }[] } | undefined)?.outbox
    if (typeof outbox !== 'function') {
        return false
    }
    const entries = outbox()
    if (args === undefined) {
        return entries.length > 0
    }
    const key = JSON.stringify(args)
    return entries.some((entry) => JSON.stringify(entry.args) === key)
}
