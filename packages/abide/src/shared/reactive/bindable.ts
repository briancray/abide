// 32.6, 49.8 — WHAT A BINDING TAKES, as the `Reactive` it writes through: the caller's own, or one
// over its `{ get, set }` pair. The one place the two are told apart for a `bind:` on a component and
// for an option a headless component binds alike. A `Reactive` IS a pair (its `get` and `set`), so
// what is told apart is a pair that is not one: no `peek`. A composed component hands the one it is
// built on a `reactiveOver`, which carries a `peek` and passes as it is, keeping the refusal its
// `set` hands back (4.18) that a pair's `set` would drop.

import { pairReactive } from './pairReactive.ts'
import type { Reactive } from './Reactive.ts'

/**
 * A `{ get, set }` pair to read and write — a `Reactive` is one.
 *
 * 31.3 — ONE TYPE LITERAL, so the compiler tells a position typed by it by its declaration, as it
 * tells a `Reactive`: a name handed there holds its `Reactive` rather than reading it.
 */
export type Bindable<Value> = { get(): Value; set(value: Value): unknown }

/** `bound` as a `Reactive`: itself where it is one, one over the pair where it is a pair. */
export function bindable<Value>(bound: Bindable<Value>): Reactive<Value>
export function bindable<Value>(
    bound: Bindable<Value> | undefined,
): Reactive<Value> | undefined
export function bindable<Value>(
    bound: Bindable<Value> | undefined,
): Reactive<Value> | undefined {
    if (bound === undefined || 'peek' in bound)
        return bound as Reactive<Value> | undefined
    return pairReactive(
        bound as { get(): unknown; set(value: unknown): void },
    ) as Reactive<Value>
}
