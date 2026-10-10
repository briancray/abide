// 32.6 — A `{ get, set }` PAIR AS A `Reactive`, for the one place a pair has to be one: a `bind:` on
// a component, whose child's prop cell adopts what it is bound to (11.12) and writes through it
// (11.59). Its value is what `get` answers, recomputed as whatever `get` reads changes; its `set` is
// the pair's, and nothing stands here — the value moves when what `get` reads does, as an element's
// `bind:value={{get, set}}` does.
//
// A PROTOTYPE, NOT A BRANCH in the core's `set`, for `brandedPrototype`'s reason: `simpleShape`
// leaves a seat it does not own alone, and the adoption path reaches this `set` through the
// callable it adopted.

import { CELL } from './CELL.ts'
import { reactive } from './index.ts'
import { brandedPrototype, type Reactive } from './Reactive.ts'

type Pair = { get(): unknown; set(value: unknown): void }

const PAIR: unique symbol = Symbol('abide.pair')

const PAIR_PROTOTYPE = brandedPrototype({
    set(this: { [PAIR]: Pair }, value: unknown): undefined {
        this[PAIR].set(value)
        return undefined
    },
})

/**
 * A `Reactive` whose value is what `pair.get` answers and whose `set` writes through `pair.set`.
 *
 * The prototype is set ON THE CELL'S OWN CALLABLE, which is what an adoption writes through and
 * what a scoped forwarder (`scoped.ts`) forwards to — re-seating the forwarder instead would drop
 * the `[CELL]` getter its prototype carries.
 */
export function pairReactive(pair: Pair): Reactive<unknown> {
    const over = reactive(() => pair.get())
    const callable = (over as unknown as { [CELL]: { callable: unknown } })[
        CELL
    ].callable as { [PAIR]: Pair }
    Object.setPrototypeOf(callable, PAIR_PROTOTYPE)
    callable[PAIR] = pair
    return over as Reactive<unknown>
}
