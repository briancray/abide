import { cache } from './cache.ts'
import type { CacheOptions } from './types/CacheOptions.ts'
import type { CacheSelector } from './types/CacheSelector.ts'
import type { RemoteFunction } from './types/RemoteFunction.ts'

/*
Mutate the retained value of the matching cached read(s) in place — reactive
(readers re-render), no network. The optimistic-update / real-time primitive:
patch a cached list from a socket frame (`on(chat, m => getList.patch(l => [...l,
m]))`) or apply an optimistic edit before a write lands. The updater receives the
current decoded value and returns the next.

  patch(getFoo, args, updater)   → that exact call
  patch(getFoo, updater)         → every args-variant of that rpc
  patch({ tags }, updater)       → every entry sharing a tag

Instance sugar `getFoo.patch(args?, updater)` ≡ `patch(getFoo, args, updater)`.
The updater is always the last argument; a not-yet-read key has nothing to patch.
*/
// @documentation cache
export function patch<Args, Return>(
    fn: RemoteFunction<Args, Return> | ((args?: Args) => Promise<Return>),
    args: Args | undefined,
    updater: (current: Return) => Return,
): void
export function patch<Args, Return>(
    fn: RemoteFunction<Args, Return> | ((args?: Args) => Promise<Return>),
    updater: (current: Return) => Return,
): void
export function patch<Return>(
    selector: Pick<CacheOptions, 'tags'>,
    updater: (current: Return) => Return,
): void
export function patch(selector: unknown, argsOrUpdater: unknown, maybeUpdater?: unknown): void {
    /* Updater is always last: 3 args → (selector, args, updater); 2 args → (selector, updater). */
    const updater = (maybeUpdater !== undefined ? maybeUpdater : argsOrUpdater) as (
        current: unknown,
    ) => unknown
    const args = maybeUpdater !== undefined ? argsOrUpdater : undefined
    cache.patch(selector as CacheSelector<unknown, unknown>, args, updater)
}
