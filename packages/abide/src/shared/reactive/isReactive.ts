import type { Reactive } from './Reactive.ts'
// 1.6 — THE BRAND, READ ON ITS OWN. A `Reactive` is callable AND thenable, so every guard that
// can meet one reads this before `typeof value === 'function'` or an `isThenable` probe.
//
// A LEAF OF ITS OWN BECAUSE AN IMPORT EDGE IS PRICED BY THE MODULE IT LANDS ON: one symbol, where
// `Reactive.ts` is the whole graph, the scheduler and the store behind it — so a module asking only
// whether a value is one (`server/trace.ts`, the element measures) does not load the core for it. The
// browser's runtime reaches the core anyway (`rows`, `TryRegion`, `Level`, `propCell`), so the leaf
// buys no client bytes. The `Reactive` import is TYPE-ONLY and erased, which is what lets the
// predicate keep its exact shape at no cost.
import { REACTIVE_BRAND } from './REACTIVE_BRAND.ts'

export function isReactive(value: unknown): value is Reactive<unknown> {
    return (
        typeof value === 'function' &&
        (value as { [REACTIVE_BRAND]?: boolean | undefined })[
            REACTIVE_BRAND
        ] === true
    )
}
