// The public face of the reactive engine.
//
//   state   — own a value
//   watch   — react to one; the returned function is the teardown
//   untrack — read a region without subscribing
//   scope   — one handle that disposes every watch created inside it
//
// `scopedEffect` is here but NOT on `abide`: it is what the compiler writes for a `watch` in a
// `<script module>`, so it reaches a built app through `abide/runtime` and an author never types it.
//
// `derive` (the argless memo) is not here: `memo` in `#shared/memo.ts` is its one public spelling,
// and there is deliberately no second name for "async memo". Everything else the engine exposes —
// `Node`, `internals` — is reachable only through `#shared/internal/graph.ts`, which is the seam
// `memo` sits on and nothing outside abide imports.

export {
    type Memo,
    type State,
    scope,
    scopedEffect,
    state,
    untrack,
    watch,
} from './internal/graph.ts'
