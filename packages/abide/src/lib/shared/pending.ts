import { isAsyncCell } from './isAsyncCell.ts'
import { probeRegistries } from './probeRegistries.ts'
import type { AsyncComputed } from './types/AsyncComputed.ts'
import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheSelector } from './types/CacheSelector.ts'
import type { NamedAsyncIterable } from './types/NamedAsyncIterable.ts'

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
    arg?: CacheSelector<Args, Return> | NamedAsyncIterable<unknown> | AsyncComputed<unknown>,
    args?: Args,
): boolean {
    /* An async cell answers from its own facet (`pending(cell)` ≡ `cell.pending()`). */
    if (isAsyncCell(arg)) {
        return arg.pending()
    }
    return probeRegistries(arg, args, 'pending', unsettled, true)
}

const unsettled = (entry: CacheEntry) => entry.settled !== true
