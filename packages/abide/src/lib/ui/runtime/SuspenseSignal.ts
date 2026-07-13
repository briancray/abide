import type { AsyncComputed } from '../../shared/types/AsyncComputed.ts'

/*
The sentinel a compiled blocking read (`$$readCellBlocking`, an `await`-marked cell) raises
when the cell has no value *yet* — "not resolved," not an error (ADR-0042 D3). It is a sibling
of `AsyncCellError` but a DISTINCT class: the client suspense boundary discriminates the two by
`instanceof`, routing a `SuspenseSignal` through the `CURRENT_SUSPENSE` slot (withhold + keep the
watch) and letting an `AsyncCellError` pass through to the author's `{#try}`. A suspend must never
reach a `{:catch}` branch, or loading would flash as an error. It carries the originating cell so
the boundary can subscribe to that cell and reveal the region once it settles. Extends `Error`
only to satisfy throw-an-Error lint and match `AsyncCellError`; it carries no `cause` — there is
nothing wrong, the value is simply pending.
*/
export class SuspenseSignal extends Error {
    readonly cell: AsyncComputed<unknown>

    constructor(cell: AsyncComputed<unknown>) {
        super('abide: suspense (value pending)')
        this.name = 'SuspenseSignal'
        this.cell = cell
    }
}
