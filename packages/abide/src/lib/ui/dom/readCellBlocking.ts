import { isAsyncCell } from '../../shared/isAsyncCell.ts'
import type { AsyncComputed } from '../../shared/types/AsyncComputed.ts'
import { AsyncCellError } from '../runtime/AsyncCellError.ts'
import { SuspenseSignal } from '../runtime/SuspenseSignal.ts'

/*
The blocking-cell read the compiler lowers to `$$readCellBlocking(NAME)` for an `await`-marked
cell (ADR-0042 D5.3). Same throwing peek as `readCell`, with one added rule: a cell with no value
*yet* throws a `SuspenseSignal` instead of returning `undefined`, so the enclosing region SUSPENDS
until the value resolves rather than rendering against `undefined`. This is what makes an `await`
binding read as a resolved `T` (never `undefined`-while-pending) on both sides — the client mirrors
the server flush barrier.

The suspend is keyed on `cell.pending()` (in-flight AND no value), NOT `peek() === undefined`:
  - a blocking cell that legitimately resolves to `undefined` is not pending, so it returns
    `undefined` and does not suspend forever;
  - a warm-seeded cell on hydrate is `refreshing()` (has value, in flight), not `pending()`, so it
    returns its held value and adopts the SSR markup with no suspend and no flash (ADR-0042 D4).
Error-with-no-retained-value still throws `AsyncCellError` to the nearest `{#try}`; a retained value
wins over both pending and error (stale-while-revalidate).
*/
// @documentation plumbing
export function readCellBlocking(cell: unknown): unknown {
    if (isAsyncCell(cell)) {
        const asyncCell = cell as AsyncComputed<unknown>
        /* No value yet → suspend the reading region (distinct from an error). */
        if (asyncCell.pending()) {
            throw new SuspenseSignal(asyncCell)
        }
        const value = asyncCell.peek()
        /* A retained value wins over an error (SWR); only nothing-retained makes an error
           "nothing to render" and throws it to `{#try}`. */
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
