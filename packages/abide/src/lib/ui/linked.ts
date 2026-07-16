import { isAsyncIterable } from '../shared/isAsyncIterable.ts'
import type { AsyncState } from '../shared/types/AsyncState.ts'
import type { NamedAsyncIterable } from '../shared/types/NamedAsyncIterable.ts'
import { CURRENT_SCOPE } from './runtime/CURRENT_SCOPE.ts'
import { createAsyncCell } from './runtime/createAsyncCell.ts'
import { createEffectNode } from './runtime/createEffectNode.ts'
import { isAsyncFunction } from './runtime/isAsyncFunction.ts'
import { routeBareSeed } from './runtime/routeBareSeed.ts'
import { SuspenseSignal } from './runtime/SuspenseSignal.ts'
import type { State } from './runtime/types/State.ts'
import { state } from './state.ts'
import type { Scope } from './types/Scope.ts'

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

When the seed tracks an async source it becomes a writable async cell (`AsyncState<T>`,
ADR-0019 D1): an `async () => await …` thunk unwraps its promise, a `NamedAsyncIterable`
seed auto-tracks its frames. Same probe surface as `AsyncComputed` plus `set()`, which
latches until the next reseed — an arriving frame never clobbers an in-progress edit.
*/
export function linked<T>(
    seed: () => NamedAsyncIterable<T>,
    transform?: (next: T, previous: T) => T,
): AsyncState<T>
export function linked<T>(
    seed: () => Promise<T>,
    transform?: (next: T, previous: T) => T,
): AsyncState<T>
export function linked<T>(seed: () => T, transform?: (next: T, previous: T) => T): State<T>
export function linked<T>(
    seed: () => T | Promise<T> | NamedAsyncIterable<T>,
    transform?: (next: T, previous: T) => T,
): State<T> | AsyncState<T> {
    const coerce = transform as ((next: unknown, previous: unknown) => unknown) | undefined
    /* A BARE seed that reached the runtime literally (a branch-nested `<script>`, a direct
       JS caller) — the compile-time `wrapSeed` normalization only covers the leading script,
       so honor the authored contract (ADR-0045) by VALUE via the shared `routeBareSeed`,
       exactly as `computed` does; a non-async value becomes a constant seed thunk (reseeds
       never fire — nothing tracked — matching the wrapped `() => value` form). */
    if (typeof seed !== 'function') {
        const value: unknown = seed
        const cell = routeBareSeed(value, true, coerce)
        if (cell !== undefined) {
            return cell as AsyncState<T>
        }
        seed = () => value as T
    }
    /* `await` marker: an async-function seed unwraps its promise into a writable async cell. */
    if (isAsyncFunction(seed)) {
        return createAsyncCell(seed as () => unknown, {
            writable: true,
            transform: coerce,
        }) as AsyncState<T>
    }
    /* Peek the seed once to detect a self-identifying stream source (auto-track); `linked`
       already runs its seed eagerly, so an early probe matches its semantics. A throw or a
       non-stream value falls through to the plain synchronous cell. */
    let probe: unknown
    let threw = false
    let suspended = false
    try {
        probe = seed()
    } catch (error) {
        threw = true
        suspended = error instanceof SuspenseSignal
    }
    /* The seed SUSPENDED — it read a pending BLOCKING cell (`await`-marked). A sync `state`
       here would hold `undefined` while the reseed effect re-threw the suspend, letting it
       escape at construction. Route to the eager async cell instead: `createAsyncCell` already
       treats a synchronously-suspending seed as "pending" — it stays in flight, the throwing
       read subscribed its effect to the blocking dependency, and it re-runs on settle — and it
       marks the cell BLOCKING so its own reads pause too, matching a lazy `computed(() =>
       blockingCell)`. This makes a blocking read behave the same in a `linked` seed as in a
       `computed` seed or a template. A real (non-suspense) throw keeps the sync fall-through. */
    if (suspended) {
        return createAsyncCell(seed as () => unknown, {
            writable: true,
            transform: coerce,
        }) as AsyncState<T>
    }
    if (!threw && isAsyncIterable(probe)) {
        return createAsyncCell(seed as () => unknown, {
            writable: true,
            transform: coerce,
        }) as AsyncState<T>
    }
    /* Reserve this cell's async-cell ordinal even though the seed resolved synchronously to a
       plain `state`. Whether a `linked` seed suspends (→ `createAsyncCell`, which draws a
       `nextCellIndex()` for its warm-seed key) or resolves synchronously (→ this plain `state`,
       drawing none) is DATA-dependent, and that data can differ across the SSR→client handoff: a
       blocking dependency still in flight on the server (→ suspend → async cell → index drawn) is
       already warm-adopted on the warm client (→ sync resolve → plain state → no index). Without
       this reserve, every async cell declared AFTER a `linked` in the same scope would key
       off-by-one between sides and adopt the wrong warm seed. Drawing the index here makes a
       `linked` ALWAYS occupy exactly one ordinal — the invariant `computed` gets for free from its
       static `isAsyncFunction` routing — so downstream keys align regardless of which path ran. A
       detached cell (no scope) never warm-seeds, so it draws nothing, mirroring `createAsyncCell`. */
    const scope = CURRENT_SCOPE.current as (Scope & { nextCellIndex: () => number }) | undefined
    scope?.nextCellIndex()
    /* The cell is a plain `state` — same store, same write path, so `transform` gates
       reseeds and explicit writes identically. */
    const cell = state<T>(undefined as T, transform)
    /* Reactive reseed: the effect tracks the seed thunk and writes the cell when its
       sources change. The cell is only written (its setter reads the store as a plain
       field, never `readNode`), so it stays off the effect's dependency list — only
       what `seed` reads can retrigger it. `createEffectNode` registers the disposer
       with the enclosing scope. */
    createEffectNode(() => {
        cell.value = seed() as T
    })
    return cell
}
