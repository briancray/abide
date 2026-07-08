import type { AsyncComputed } from '../../shared/types/AsyncComputed.ts'

/*
The throw a compiled async-cell read (`$$readCell`) raises when the cell is in error
with no retained value — routed to the nearest reactive `{#try}`. It carries the
originating cell so the boundary can subscribe to that cell's lifecycle and re-arm
the guarded content when the cell recovers (error→value via a `refresh()` or a
dependency change) — "keep watching what threw" (ADR-0019 D3.3). A plain `peek()` in
JS never throws; the throw is a template-lowering behaviour only, so the cause is
carried through unchanged for an author's `{:catch err}` binding.
*/
export class AsyncCellError extends Error {
    readonly cell: AsyncComputed<unknown>

    constructor(cell: AsyncComputed<unknown>, cause: unknown) {
        super(cause instanceof Error ? cause.message : String(cause), { cause })
        this.name = 'AsyncCellError'
        this.cell = cell
    }
}
