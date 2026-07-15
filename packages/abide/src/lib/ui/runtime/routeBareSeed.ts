import { isAsyncIterable } from '../../shared/isAsyncIterable.ts'
import { isThenable } from '../../shared/isThenable.ts'
import type { AsyncComputed } from '../../shared/types/AsyncComputed.ts'
import type { AsyncState } from '../../shared/types/AsyncState.ts'
import { createAsyncCell } from './createAsyncCell.ts'

/*
The ONE statement of the ADR-0045 bare-seed contract for `computed`/`linked`: a bare
seed that reached the runtime literally (a branch-nested `<script>` keeps its
`state.computed(...)` calls literal, and a direct JS caller never compiles) routes BY
VALUE exactly as its thunk form would — a promise → a streaming unwrapped value cell, a
stream → a frame cell. Anything else returns `undefined`: not async, the caller wraps it
as a constant seed thunk. The classification order (thenable before async-iterable) and
the streaming flag are load-bearing and shared here so the two primitives cannot drift.
*/
export function routeBareSeed(
    value: unknown,
    writable: boolean,
    transform?: (next: unknown, previous: unknown) => unknown,
): AsyncComputed<unknown> | AsyncState<unknown> | undefined {
    if (isThenable(value)) {
        return createAsyncCell(() => value, { writable, transform, streaming: true })
    }
    if (isAsyncIterable(value)) {
        return createAsyncCell(() => value, { writable, transform })
    }
    return undefined
}
