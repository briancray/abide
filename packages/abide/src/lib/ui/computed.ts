import { isAsyncIterable } from '../shared/isAsyncIterable.ts'
import { isThenable } from '../shared/isThenable.ts'
import type { AsyncComputed } from '../shared/types/AsyncComputed.ts'
import type { NamedAsyncIterable } from '../shared/types/NamedAsyncIterable.ts'
import { createAsyncCell } from './runtime/createAsyncCell.ts'
import { createComputedNode } from './runtime/createComputedNode.ts'
import { isAsyncFunction } from './runtime/isAsyncFunction.ts'
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

When the seed *tracks* an async source it becomes an async cell instead (ADR-0019
D1): an `async () => await …` thunk (the compiler's `await` lowering) unwraps the
promise, and a thunk producing a `NamedAsyncIterable` (socket / streaming rpc)
auto-tracks its frames. Both yield an `AsyncComputed<T>` — no `.value`, read through
the probe family (`peek`/`pending`/`refreshing`/`error`/`refresh`). A thunk that
returns a *bare* promise (no `await`) is held opaquely as a normal `Computed<Promise<T>>`
— render it with `{#await}`.
*/
export function computed<T>(compute: () => NamedAsyncIterable<T>): AsyncComputed<T>
export function computed<T>(compute: () => Promise<T>): AsyncComputed<T>
export function computed<T>(compute: () => T): Computed<T>
export function computed<T>(
    compute: () => T | Promise<T> | NamedAsyncIterable<T>,
): Computed<T> | AsyncComputed<T> {
    /* A BARE seed that reached the runtime literally — a branch-nested `<script>` (which
       keeps its `state.computed(...)` calls literal; see lowerScript) or a direct JS caller.
       The compile-time `wrapSeed` normalization only covers the leading script, so honor the
       same authored contract (ADR-0045: a bare seed behaves like its thunk form) by VALUE:
       a promise → a streaming unwrapped value cell, a stream → a frame cell, any other
       value → a constant computed over it. Without this a raw value lands as `node.compute`
       and the first read calls it (`node.compute is 3` — a dead render mid-stream). */
    if (typeof compute !== 'function') {
        const seed: unknown = compute
        if (isThenable(seed)) {
            return createAsyncCell(() => seed, {
                writable: false,
                streaming: true,
            }) as AsyncComputed<T>
        }
        if (isAsyncIterable(seed)) {
            return createAsyncCell(() => seed, { writable: false }) as AsyncComputed<T>
        }
        compute = () => seed as T
    }
    /* `await` marker: an async-function thunk unwraps its promise into a tracked async cell.
       This is the only classification the read-only primitive can make without running the
       seed — a sync `computed` MUST stay lazy (it does not compute until first read). A stream
       seed (`computed(getStream())`) can only be told from a sync seed by running it, which
       laziness forbids here; the compiler routes that eager path to `createAsyncCell` directly.
       A bare (un-awaited) promise stays a lazy `Computed<Promise<T>>` — render it with `{#await}`. */
    if (isAsyncFunction(compute)) {
        return createAsyncCell(compute as () => unknown, { writable: false }) as AsyncComputed<T>
    }
    /* Sync value or a bare (opaque) promise: the lazy computed, unchanged. */
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
