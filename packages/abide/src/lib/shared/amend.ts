import { cache } from './cache.ts'
import type { CacheOptions } from './types/CacheOptions.ts'
import type { CacheSelector } from './types/CacheSelector.ts'
import type { RemoteFunction } from './types/RemoteFunction.ts'

/*
Mutate the retained value of the matching cached read(s) in place — reactive
(readers re-render), no network. The optimistic-update / real-time primitive:
amend a cached list from a socket frame (`on(chat, m => getList.amend(l => [...l,
m]))`) or apply an optimistic edit before a write lands. The updater receives the
current decoded value and returns the next.

  amend(getFoo, args, updater)   → that exact call
  amend(getFoo, updater)         → every args-variant of that rpc
  amend({ tags }, updater)       → every entry sharing a tag

Instance sugar `getFoo.amend(args?, updater)` ≡ `amend(getFoo, args, updater)`.
The updater is always the last argument; a not-yet-read key has nothing to amend.
*/
// @documentation cache
export function amend<Args, Return>(
    fn: RemoteFunction<Args, Return> | ((args?: Args) => Promise<Return>),
    args: Args | undefined,
    updater: (current: Return) => Return,
): void
export function amend<Args, Return>(
    fn: RemoteFunction<Args, Return> | ((args?: Args) => Promise<Return>),
    updater: (current: Return) => Return,
): void
export function amend<Return>(
    selector: Pick<CacheOptions, 'tags'>,
    updater: (current: Return) => Return,
): void
export function amend(selector: unknown, argsOrUpdater: unknown, maybeUpdater?: unknown): void {
    /* Updater is always last: 3 args → (selector, args, updater); 2 args → (selector, updater). */
    const updater = (maybeUpdater !== undefined ? maybeUpdater : argsOrUpdater) as (
        current: unknown,
    ) => unknown
    const args = maybeUpdater !== undefined ? argsOrUpdater : undefined
    cache.amend(selector as CacheSelector<unknown, unknown>, args, updater)
}
