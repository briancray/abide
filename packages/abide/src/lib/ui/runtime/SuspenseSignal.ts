import type { AsyncComputed } from '../../shared/types/AsyncComputed.ts'

/*
The sentinel `readCell` raises when a BLOCKING cell (`cell.blocking` — an `await`-marked cell)
has no value *yet* — "not resolved," not an error (ADR-0042 D3). It is a sibling
of `AsyncCellError` but a DISTINCT class so the two are told apart by `instanceof`: a suspend is
caught LOCALLY by the reading region — each DOM primitive (`appendText`, `attr`, `each`,
`spreadAttrs`, `watch`, and the `when`/`switchBlock` condition) swallows it and withholds to an
empty fallback, re-running on settle because the throwing read already subscribed the region's
effect to the cell. It must never be handled as an error: `flushEffects` refuses to route a
`SuspenseSignal` to a reactive `{#try}` (that would flash the author's `{:catch}` during loading),
while an `AsyncCellError` still passes through. It carries the originating cell for diagnostics.
Extends `Error` only to satisfy throw-an-Error lint and match `AsyncCellError`; it carries no
`cause` — there is nothing wrong, the value is simply pending.
*/
export class SuspenseSignal extends Error {
    readonly cell: AsyncComputed<unknown>

    constructor(cell: AsyncComputed<unknown>) {
        super('abide: suspense (value pending)')
        this.name = 'SuspenseSignal'
        this.cell = cell
    }
}
