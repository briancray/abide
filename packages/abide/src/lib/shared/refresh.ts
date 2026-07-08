import { cache } from './cache.ts'
import { isAsyncCell } from './isAsyncCell.ts'
import type { AsyncComputed } from './types/AsyncComputed.ts'
import type { CacheSelector } from './types/CacheSelector.ts'

/*
Refetch every cached read matching the selector, keeping the stale value visible
until the fresh one swaps in (refreshing() true meanwhile) — the smart-call
refetch. Because the smart read retains its value on the client (SWR
unconditional there), a refresh always refetches-and-swaps; it never drops to a
pending blank. Follows the shared selector grammar:

  refresh(getFoo, args)   → that exact call
  refresh(getFoo)         → every args-variant of that rpc
  refresh({ tags })       → every entry sharing a tag
  refresh()               → every entry

Instance sugar `getFoo.refresh(args?)` ≡ `refresh(getFoo, args?)`. Reports, never
retains a spinner — pair with `refreshing()` to surface the in-flight reload.
*/
// @documentation cache
export function refresh<Args, Return>(
    arg?: CacheSelector<Args, Return> | AsyncComputed<unknown>,
    args?: Args,
): void {
    /* An async cell re-invokes its own seed (`refresh(cell)` ≡ `cell.refresh()`). */
    if (isAsyncCell(arg)) {
        arg.refresh()
        return
    }
    cache.refresh(arg as CacheSelector<Args, Return>, args)
}
