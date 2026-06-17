import { createComputedNode } from './runtime/createComputedNode.ts'
import { OWNER } from './runtime/OWNER.ts'
import { readNode } from './runtime/readNode.ts'
import type { Derived } from './runtime/types/Derived.ts'
import type { State } from './runtime/types/State.ts'
import { unlinkDeps } from './runtime/unlinkDeps.ts'

/*
A reactive cell computed from other cells — the abide replacement for `$derived`.
Lazy: it recomputes on read only when a dependency has changed, and never
serializes (it is re-derived from its inputs on resume). Read via `.value`.

With a `set`, it becomes a writable lens (Vue/Svelte's writable computed): the
value still derives from upstream, but assigning `.value` runs `set`, whose job
is to write *through* to the upstream sources. The write retriggers those
sources, marking this computed dirty, so the next read recomputes — there is no
local store, upstream stays the single source of truth. `set` is imperative
(void): it writes an external target, unlike `state`/`linked`'s `transform`,
which returns a value into their own store.
*/
// @readme plumbing
export function derived<T>(compute: () => T): Derived<T>
export function derived<T>(compute: () => T, set: (next: T) => void): State<T>
export function derived<T>(compute: () => T, set?: (next: T) => void): Derived<T> | State<T> {
    const node = createComputedNode(compute as () => unknown)
    /* Tear down with the enclosing scope, the way an effect does. A computed only
       unlinks from its sources when it re-runs (`runNode` re-tracking); one read
       once and then abandoned never re-runs, so absent this it would sit in its
       source signals' subscriber lists forever — re-marked dirty on every write to
       them — for the source's lifetime. Outside a scope it owns its own life (no-op). */
    if (OWNER.current !== undefined) {
        OWNER.current.push(() => unlinkDeps(node))
    }
    if (set === undefined) {
        return {
            get value(): T {
                return readNode(node) as T
            },
        }
    }
    return {
        get value(): T {
            return readNode(node) as T
        },
        set value(next: T) {
            set(next)
        },
    }
}
