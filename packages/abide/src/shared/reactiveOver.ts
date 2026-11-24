// A BOUND PROP HANDED TO A HEADLESS COMPONENT AS THE `Reactive` IT TAKES. In a `.abide`, a destructured prop
// reaches a function as its value (31.3), so a component passing its bindable prop to its parts hands
// over this instead: read live, and written back to whoever binds it — the three members a parts
// function calls on a `Reactive` it is handed.

import type { Reactive } from './reactive/index.ts'

/** `read` and `write` standing in for a `Reactive`: called and `peek`ed through `read`, `set` through `write`. */
export function reactiveOver<Value>(
    read: () => Value,
    write: (next: Value) => void,
): Reactive<Value> {
    return Object.assign(() => read(), {
        peek: read,
        set: write,
    }) as unknown as Reactive<Value>
}
