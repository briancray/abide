import { createComputedNode } from './runtime/createComputedNode.ts'
import { OWNER } from './runtime/OWNER.ts'
import { readNode } from './runtime/readNode.ts'
import type { Computed } from './runtime/types/Computed.ts'
import { unlinkDeps } from './runtime/unlinkDeps.ts'

/*
A reactive cell computed from other cells — the abide replacement for `$derived`.
Named `computed` (not `derived`) and ALWAYS read-only: unlike Svelte's reassignable
`$derived`, a computed is purely a function of its inputs, the way Vue/Angular
`computed` is. There is no local store and nothing to assign — a write to a computed
would be a write to its *sources*, which is expressed at the binding site instead
(`bind:value={{ get, set }}`), where the write actually originates. Lazy: it
recomputes on read only when a dependency changed, and never serializes (it is
re-derived from its inputs on resume). Read via `.value`.
*/
export function computed<T>(compute: () => T): Computed<T> {
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
