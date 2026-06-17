import { createEffectNode } from './runtime/createEffectNode.ts'
import type { State } from './runtime/types/State.ts'
import { state } from './state.ts'

/*
A writable cell seeded reactively from upstream — the abide form of Angular's
`linkedSignal`. Like `state` it owns a local value and can diverge from its
source (an edit-form draft, a local working copy); unlike `state` the seed is a
reactive thunk, so the cell reseeds whenever the thunk's dependencies change.
Between reseeds it holds whatever was written to it, and edits never flow upstream
(the seed reads, it does not write). The thunk is mandatory: it *is* the
reactivity — a bare value can never reseed, which would just make this `state`.

`transform` is the same coercion gate as on `state`, and it runs on *every* value
entering the store — explicit `.value =` writes and reseeds alike — so the store
never holds an un-coerced value (`return previous` rejects via the `Object.is`
no-op). The seed is captured by reference: callers clone in the thunk
(`linked(() => structuredClone(x))`) when they want isolation.
*/
// @readme plumbing
export function linked<T>(seed: () => T, transform?: (next: T, previous: T) => T): State<T> {
    /* The cell is a plain `state` — same store, same write path, so `transform` gates
       reseeds and explicit writes identically. */
    const cell = state<T>(undefined as T, transform)
    /* Reactive reseed: the effect tracks the seed thunk and writes the cell when its
       sources change. The cell is only written (its setter reads the store as a plain
       field, never `readNode`), so it stays off the effect's dependency list — only
       what `seed` reads can retrigger it. `createEffectNode` registers the disposer
       with the enclosing scope. */
    createEffectNode(() => {
        cell.value = seed()
    })
    return cell
}
