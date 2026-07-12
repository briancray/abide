import type { LiftPosition } from '../liftAsyncSubExpressions.ts'

/* One async-liftable interpolation field of a template node — the shared reading both compile
   front-ends drive their async lowering from (the block-Plan pattern of `ifPlan`/`awaitPlan`,
   applied to interpolations instead of block structure). `code`/`loc` are the authored expression
   and its absolute source offset; `position` is its value/content position (which feeds the shared
   sub-expression walk's `each`-forbids-`AsyncIterable` rule). `subject` marks a control-flow test
   (`{#if}` / `{:elseif}` / `{#switch}`) whose WHOLE expression lifting to one cell makes the block
   hold while the cell is pending. `write` reseeds the field with the runtime's rewritten reference
   and `setAsyncSubject` records the subject verdict — both are no-ops for a READER like the shadow,
   which needs only `code`/`loc`/`position` to peek-wrap its projection. */
export type AsyncInterpolationField = {
    code: string
    loc: number
    position: LiftPosition
    subject: boolean
    write: (code: string) => void
    setAsyncSubject: (asyncSubject: boolean) => void
}
