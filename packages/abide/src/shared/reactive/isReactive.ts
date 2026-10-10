// 1.6 — THE BRAND, READ ON ITS OWN. A `Reactive` is callable AND thenable, so every guard that
// can meet one reads this before `typeof value === 'function'` or an `isThenable` probe.
//
// A LEAF OF ITS OWN BECAUSE AN IMPORT EDGE IS PRICED BY THE MODULE IT LANDS ON. This is one
// symbol, and it was reached through `Reactive.ts` — the whole graph, the scheduler and the store
// behind it. `bindElement` is on the `@abide/abide/runtime` barrel every compiled client module
// resolves through, so that one edge put the core in the shared
// chunk EVERY page loads: two entries built with `--splitting` shared 55,273 bytes through it and
// 2,348 bytes without it. The `Reactive` import is TYPE-ONLY and erased, which is what lets the
// predicate keep its exact shape at no cost.
import { REACTIVE_BRAND } from './REACTIVE_BRAND.ts'
import type { Reactive } from './Reactive.ts'

export function isReactive(value: unknown): value is Reactive<unknown> {
    return (
        typeof value === 'function' &&
        (value as { [REACTIVE_BRAND]?: boolean })[REACTIVE_BRAND] === true
    )
}
