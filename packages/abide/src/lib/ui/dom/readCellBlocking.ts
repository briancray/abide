import { isAsyncCell } from '../../shared/isAsyncCell.ts'
import type { AsyncComputed } from '../../shared/types/AsyncComputed.ts'
import { SuspenseSignal } from '../runtime/SuspenseSignal.ts'
import { readCell } from './readCell.ts'

/*
The blocking-cell read the compiler lowers to `$$readCellBlocking(NAME)` for an `await`-marked
cell (ADR-0042 D5.3). Exactly `readCell`, with one added rule ahead of it: a cell with no value
*yet* throws a `SuspenseSignal` so the enclosing region SUSPENDS until the value resolves rather
than rendering against `undefined`. This is what makes an `await` binding read as a resolved `T`
(never `undefined`-while-pending) on both sides — the client mirrors the server flush barrier.

The suspend is keyed on `cell.pending()` (in-flight AND no value), NOT `peek() === undefined`:
  - a blocking cell that legitimately resolves to `undefined` is not pending, so it does not
    suspend forever;
  - a warm-seeded cell on hydrate is `refreshing()` (has value, in flight), not `pending()`, so it
    reads its held value and adopts the SSR markup with no suspend and no flash (ADR-0042 D4).
Everything past the pending gate — the throwing peek (error-with-no-retained-value → `AsyncCellError`
to `{#try}`, a retained value winning over pending/error via SWR), a function call, or a `.value`
read — is `readCell` verbatim, so the two reads can never drift.
*/
// @documentation plumbing
export function readCellBlocking(cell: unknown): unknown {
    /* No value yet → suspend the reading region (distinct from an error, which `readCell` routes). */
    if (isAsyncCell(cell) && (cell as AsyncComputed<unknown>).pending()) {
        throw new SuspenseSignal(cell as AsyncComputed<unknown>)
    }
    return readCell(cell)
}
