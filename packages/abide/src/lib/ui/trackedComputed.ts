import { isSubscribable } from '../shared/isSubscribable.ts'
import type { AsyncComputed } from '../shared/types/AsyncComputed.ts'
import type { NamedAsyncIterable } from '../shared/types/NamedAsyncIterable.ts'
import { createAsyncCell } from './runtime/createAsyncCell.ts'
import { createComputedNode } from './runtime/createComputedNode.ts'
import { isAsyncFunction } from './runtime/isAsyncFunction.ts'
import { OWNER } from './runtime/OWNER.ts'
import { readNode } from './runtime/readNode.ts'
import type { Computed } from './runtime/types/Computed.ts'
import { unlinkDeps } from './runtime/unlinkDeps.ts'
import { untrack } from './runtime/untrack.ts'

/*
The eager, stream-classifying read-only computed the compiler routes a bare-call /
identifier seed to — `computed(getStream())` / `computed(ref)` (ADR-0019 D1). Unlike the
lazy `computed` primitive it PROBES its seed once to self-identify the source: a
`NamedAsyncIterable` (socket / streaming rpc) auto-tracks its frames as an `AsyncComputed`,
an `async () => await …` seed unwraps its promise, and anything else — a sync value, a bare
opaque promise — falls back to the lazy `Computed`, so laziness is preserved on the miss and
only a real stream/promise producer becomes a cell. It lives apart from the `computed`
primitive so a DIRECT `computed(() => …)` call stays lazy (the primitive never probes); the
eager probe is reached only through this compiler-emitted entry, matching how `linked`
already classifies its seed. The probe runs untracked — a throwaway read must not subscribe
the enclosing build.
*/
export function trackedComputed<T>(
    compute: () => T | Promise<T> | NamedAsyncIterable<T>,
): Computed<T> | AsyncComputed<T> {
    /* `await` marker: an async-function seed unwraps its promise into a read-only async cell. */
    if (isAsyncFunction(compute)) {
        return createAsyncCell(compute as () => unknown, { writable: false }) as AsyncComputed<T>
    }
    /* Probe the seed once (untracked) to detect a self-identifying stream. A discarded stream
       iterable costs nothing — a streaming rpc defers its fetch to the first pull, which never
       happens here; a throw means a plain reactive compute, so fall through to the lazy path
       (it throws at read, unchanged). */
    let probe: unknown
    let threw = false
    try {
        probe = untrack(compute)
    } catch {
        threw = true
    }
    if (!threw && isSubscribable(probe)) {
        return createAsyncCell(compute as () => unknown, { writable: false }) as AsyncComputed<T>
    }
    /* Sync value or a bare (opaque) promise: the lazy computed, identical to the primitive. */
    const node = createComputedNode(compute as () => unknown)
    if (OWNER.current !== undefined) {
        OWNER.current.push(() => unlinkDeps(node))
    }
    return {
        get value(): T {
            return readNode(node) as T
        },
    }
}
