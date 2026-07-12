import { isAsyncCell } from '../../shared/isAsyncCell.ts'
import type { AsyncState } from '../../shared/types/AsyncState.ts'

/*
Unified write for a `linked` reference the compiler lowers to `$$writeCell(NAME, value)`
from an author assignment (`draft = x`, `draft += 1`, `draft++`). The read side is
`$$readCell` — a call, so not an assignable target — which is why an assignment to a
`linked` binding needs its own lowering. A `linked` cell is a writable `State` for a
sync seed (write `.value`) or a writable `AsyncState` for an async/stream seed (write
`.set(value)`, which latches until the next reseed); one write shape covers both, so
codegen never branches on the seed kind. Returns `value` so the lowered assignment still
evaluates to the written value in expression position (`a = b = draft = x`).
*/
// @documentation plumbing
export function writeCell(cell: unknown, value: unknown): unknown {
    if (isAsyncCell(cell)) {
        ;(cell as AsyncState<unknown>).set(value)
    } else {
        ;(cell as { value: unknown }).value = value
    }
    return value
}
