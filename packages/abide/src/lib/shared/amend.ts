import { amendBroadcastSlot } from './amendBroadcastSlot.ts'
import type { CacheOptions } from './types/CacheOptions.ts'
import type { CacheSelector } from './types/CacheSelector.ts'
import type { RemoteFunction } from './types/RemoteFunction.ts'

/*
Mutate the retained value of the matching cached read(s) in place — reactive
(readers re-render), no network. The optimistic-update / real-time primitive:
amend a cached list from a socket frame (`on(chat, m => getList.amend(l => [...l,
m]))`) or apply an optimistic edit before a write lands. The last argument is
either a concrete `Return` value (set it) or an updater `(current) => Return`
(transform the current decoded value). The value form is what a server-side
`amend(args, value)` broadcasts (ADR-0043 phase 2); the updater form is a closure
and stays local.

  amend(getFoo, args, value | updater)   → that exact call
  amend(getFoo, value | updater)         → every args-variant of that rpc
  amend({ tags }, value | updater)       → every entry sharing a tag

Instance sugar `getFoo.amend(args?, value | updater)` ≡ `amend(getFoo, args, …)`;
for a no-input rpc the args collapse away (`getFoo.amend(value)` — ADR-0043). The
value/updater is always the last argument; a not-yet-read key has nothing to amend.
*/
// @documentation cache
export function amend<Args, Return>(
    fn: RemoteFunction<Args, Return> | ((args?: Args) => Promise<Return>),
    args: Args | undefined,
    value: Return | ((current: Return) => Return),
): void
export function amend<Args, Return>(
    fn: RemoteFunction<Args, Return> | ((args?: Args) => Promise<Return>),
    value: Return | ((current: Return) => Return),
): void
export function amend<Return>(
    selector: Pick<CacheOptions, 'tags'>,
    value: Return | ((current: Return) => Return),
): void
export function amend(selector: unknown, argsOrPayload: unknown, maybePayload?: unknown): void {
    /* Payload (value or updater) is always last: 3 args → (selector, args, payload); 2 args →
       (selector, payload). A function payload is an updater (a local closure); anything else is
       a replacement value — a Return that is itself a function must be wrapped by the caller
       (ADR-0043). Both forms route through the side-swap slot: on the client it applies locally,
       on the server the value form broadcasts and the updater form throws. */
    const payload = maybePayload !== undefined ? maybePayload : argsOrPayload
    const args = maybePayload !== undefined ? argsOrPayload : undefined
    const isValue = typeof payload !== 'function'
    amendBroadcastSlot.get()?.(selector as CacheSelector<unknown, unknown>, args, isValue, payload)
}
