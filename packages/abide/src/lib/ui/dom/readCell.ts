import { isAsyncCell } from '../../shared/isAsyncCell.ts'
import type { AsyncComputed } from '../../shared/types/AsyncComputed.ts'
import { AsyncCellError } from '../runtime/AsyncCellError.ts'
import { SuspenseSignal } from '../runtime/SuspenseSignal.ts'

/*
The one read for a `computed`/`linked` reference the compiler lowers to `$$readCell(NAME)`,
everywhere — script and template, both sides. An async cell (`AsyncComputed`/`AsyncState`)
yields its latest retained value, a `derive` reader (a function) is called, and a sync
`Computed`/`State` yields its `.value`. One read shape lets a `linked`/`computed` binding
auto-track whichever source it resolved to — a settling promise, a stream, or a plain value —
with no read-site branching in codegen.

Whether a read PAUSES is a property of the NODE, not the read site (ADR-0042). A pending
blocking cell (`cell.blocking` — author `await`, the one that joins the SSR barrier) throws
a `SuspenseSignal`: the reader's branch of the graph pauses until the value resolves, and
the throwing read subscribed the reader to the cell so it re-runs on settle. A pending
STREAMING cell peeks `undefined` (composes with `?.`/`??`). So a rendering region withholds,
a derive over it pauses too, and the SSR barrier awaits it — all off the same node bit,
with no per-site knowledge threaded through the compiler.

For a settled async cell this stays the value-aware **throwing peek** (ADR-0019 D3.2):
  - error AND no retained value → throw `AsyncCellError` (carries the cell for keep-the-watch);
  - error WITH a retained value → the value (a failed background refresh stays visible — SWR);
  - resolved → the value.
The throws are codegen behaviour only — `cell.peek()`/`cell.error()` in JS never throw; the
author handles an error locally via the probes, or lets it reach a `{#try}`.
*/
// @documentation plumbing
export function readCell(cell: unknown): unknown {
    if (isAsyncCell(cell)) {
        const asyncCell = cell as AsyncComputed<unknown> & { blocking?: boolean }
        const value = asyncCell.peek()
        /* A retained value wins over an error (SWR) and over pending — return it. Only when
           nothing is retained does the cell's state decide: an error is "nothing to render"
           (throw to `{#try}`); a pending blocking cell PAUSES (throw suspense); a pending
           streaming cell — or a blocking cell that legitimately resolved to `undefined` — is
           the bare `undefined`. `pending()` (in flight, no value) gates the suspend so a
           resolved-`undefined` blocking cell never suspends forever. */
        if (value === undefined) {
            const error = asyncCell.error()
            if (error !== undefined) {
                throw new AsyncCellError(asyncCell, error)
            }
            if (asyncCell.blocking === true && asyncCell.pending()) {
                throw new SuspenseSignal(asyncCell)
            }
        }
        return value
    }
    if (typeof cell === 'function') {
        return (cell as () => unknown)()
    }
    return (cell as { value: unknown }).value
}
