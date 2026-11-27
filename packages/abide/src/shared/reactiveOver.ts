// A BOUND PROP HANDED TO A HEADLESS COMPONENT AS THE `Reactive` IT TAKES. In a `.abide`, a destructured prop
// reaches a function as its value (31.3), so a component passing its bindable prop to its parts hands
// over this instead: read live, and written back to whoever binds it — the members a parts function
// calls on a `Reactive` it is handed.

import type { Reactive } from './reactive/index.ts'
import { untracked } from './reactive/tracking.ts'

/**
 * `read` and `write` standing in for a `Reactive`: read through `read`, `peek`ed through it untracked
 * so a peek joins no flow (2.11), and `set` through `write`, which hands back the refusal of the write
 * it makes (4.18).
 */
export function reactiveOver<Value>(
    read: () => Value,
    write: (next: Value) => unknown,
): Reactive<Value> {
    return {
        get: read,
        peek: () => untracked(read, undefined, undefined),
        set: write,
    } as unknown as Reactive<Value>
}
