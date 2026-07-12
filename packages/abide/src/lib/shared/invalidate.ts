import { cacheStalenessSlot } from './cacheStalenessSlot.ts'
import { isAsyncCell } from './isAsyncCell.ts'
import type { AsyncComputed } from './types/AsyncComputed.ts'
import type { CacheSelector } from './types/CacheSelector.ts'

/*
Drop every cached read matching the selector so the next read reloads it lazily —
the drop verb, distinct from refresh (which refetches now, keeping the stale value
visible). A mounted RETAINED reader revalidates stale-in-place under invalidate too
(its retain+invalidation policy keeps the value and refetches); a background /
non-retained entry (an explicit `cache()`, a producer, a reader-less entry) is
dropped and refetches only when re-read. Follows the shared selector grammar:

  invalidate(getFoo, args)   → that exact call
  invalidate(getFoo)         → every args-variant of that rpc
  invalidate({ tags })       → every entry sharing a tag
  invalidate()               → every entry

Instance sugar `getFoo.invalidate(args?)` ≡ `invalidate(getFoo, args?)`.

Isomorphic (ADR-0041): applied LOCALLY on the client, and on the SERVER it
broadcasts to every connected client (each applies the local drop). The side-swap
rides the cacheStalenessSlot resolver — this source is byte-identical on both
sides. `invalidate(asyncCell)` aliases `cell.refresh()` (a cell has no droppable
entry; its staleness is re-running its seed), matching `refresh(cell)`.
*/
// @documentation cache
export function invalidate<Args, Return>(
    arg?: CacheSelector<Args, Return> | AsyncComputed<unknown>,
    args?: Args,
): void {
    /* An async cell re-invokes its own seed (`invalidate(cell)` ≡ `cell.refresh()`). */
    if (isAsyncCell(arg)) {
        arg.refresh()
        return
    }
    /* Side-swap: the client entry applies locally; the server entry broadcasts. */
    cacheStalenessSlot.get()?.('invalidate', arg as CacheSelector<Args, Return>, args)
}
