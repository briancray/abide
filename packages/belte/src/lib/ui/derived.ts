import { createComputedNode } from './runtime/createComputedNode.ts'
import { readNode } from './runtime/readNode.ts'
import type { Derived } from './runtime/types/Derived.ts'

/*
A read-only reactive cell computed from other cells — the belte replacement for
`$derived`. Lazy: it recomputes on read only when a dependency has changed, and
never serializes (it is re-derived from its inputs on resume). Read via `.value`.
*/
// @readme plumbing
export function derived<T>(compute: () => T): Derived<T> {
    const node = createComputedNode(compute as () => unknown)
    return {
        get value(): T {
            return readNode(node) as T
        },
    }
}
