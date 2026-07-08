import { isAsyncCell } from '../../shared/isAsyncCell.ts'
import type { AsyncComputed } from '../../shared/types/AsyncComputed.ts'
import { AsyncCellError } from '../runtime/AsyncCellError.ts'

/*
Unified read for a `computed`/`linked` reference the compiler lowers to `$$readCell(NAME)`:
an async cell (`AsyncComputed`/`AsyncState`) yields its latest retained value, a `derive`
reader (a function) is called, and a sync `Computed`/`State` yields its `.value`. One read
shape lets a `linked`/`computed` binding auto-track whichever source it resolved to — a
settling promise, a stream, or a plain value — with no read-site branching in codegen.

For an async cell this is a **throwing peek** (ADR-0019 D3.2), the value-aware rule that
routes a "nothing to render" error to the nearest `{#try}`:
  - error AND no retained value → throw `AsyncCellError` (carries the cell for keep-the-watch);
  - error WITH a retained value → the value (a failed background refresh stays visible — SWR);
  - pending (no value) → `undefined`;
  - resolved → the value.
The throw is a codegen behaviour only — `cell.peek()`/`cell.error()` in JS never throw; the
author handles an error locally via the probes, or lets it reach a `{#try}`.
*/
// @documentation plumbing
export function readCell(cell: unknown): unknown {
    if (isAsyncCell(cell)) {
        const asyncCell = cell as AsyncComputed<unknown>
        const value = asyncCell.peek()
        /* A retained value wins over an error (SWR) and over pending — return it. Only when
           nothing is retained does an error become "nothing to render" and throw. */
        if (value === undefined) {
            const error = asyncCell.error()
            if (error !== undefined) {
                throw new AsyncCellError(asyncCell, error)
            }
        }
        return value
    }
    if (typeof cell === 'function') {
        return (cell as () => unknown)()
    }
    return (cell as { value: unknown }).value
}
