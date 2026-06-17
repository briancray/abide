import { createComputedNode } from './runtime/createComputedNode.ts'
import { OWNER } from './runtime/OWNER.ts'
import { readNode } from './runtime/readNode.ts'
import type { Derived } from './runtime/types/Derived.ts'
import { unlinkDeps } from './runtime/unlinkDeps.ts'

/*
A read-only reactive cell computed from other cells — the abide replacement for
`$derived`. Lazy: it recomputes on read only when a dependency has changed, and
never serializes (it is re-derived from its inputs on resume). Read via `.value`.
*/
// @readme plumbing
export function derived<T>(compute: () => T): Derived<T> {
    const node = createComputedNode(compute as () => unknown)
    /* Tear down with the enclosing scope, the way an effect does. A computed only
       unlinks from its sources when it re-runs (`runNode` re-tracking); one read
       once and then abandoned never re-runs, so absent this it would sit in its
       source signals' subscriber lists forever — re-marked dirty on every write to
       them — for the source's lifetime. Outside a scope it owns its own life (no-op). */
    if (OWNER.current !== undefined) {
        OWNER.current.push(() => unlinkDeps(node))
    }
    return {
        get value(): T {
            return readNode(node) as T
        },
    }
}
