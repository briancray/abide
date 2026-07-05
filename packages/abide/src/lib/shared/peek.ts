import { cache } from './cache.ts'
import type { RemoteFunction } from './types/RemoteFunction.ts'

/*
The value member of the probe family: the currently-retained value of a cached
read, synchronously and without triggering a fetch — `Return | undefined`
(undefined when nothing is retained yet). Reactive in a tracking scope
(state.computed / on / template): re-runs when the value changes (a refresh lands,
a patch mutates it); a one-shot snapshot outside a scope. Instance sugar
`getFoo.peek(args?)` ≡ `peek(getFoo, args?)`.

  peek(getFoo, args?)   → the retained value for that call
*/
// @documentation probes
export function peek<Args, Return>(
    fn: RemoteFunction<Args, Return>,
    args?: Args,
): Return | undefined {
    return cache.peek(fn, args)
}
