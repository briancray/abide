import { isAsyncCell } from '../../shared/isAsyncCell.ts'
import type { AsyncComputed } from '../../shared/types/AsyncComputed.ts'

/*
Whether a control-flow subject (`{#if}`/`{#switch}`) is a still-loading async cell — no
value yet, no error (`AsyncComputed.pending()`). The compiler pairs it with the value read
for a bare async subject: while `cellPending(cell)` is true the block renders NO branch, so
"still loading" never collapses into the falsy branch (`{#if getProfile()}` does not flash
its `{:else}` before the promise settles). A settled falsy value (or a held value being
refreshed) is NOT pending, so it still routes to its branch. Non-async subjects (a plain
value, a sync `computed`) are never pending — the block reads them directly.

Reading `pending()` subscribes the block's effect to the cell's in-flight/has-value facets,
so the block re-renders when the value arrives. An errored cell is NOT pending: the paired
value read (`$$readCell`) then throws its `AsyncCellError`, routing the error to the nearest
`{#try}` exactly as a bare read does.
*/
// @documentation plumbing
export function cellPending(cell: unknown): boolean {
    if (isAsyncCell(cell)) {
        return (cell as AsyncComputed<unknown>).pending()
    }
    return false
}
