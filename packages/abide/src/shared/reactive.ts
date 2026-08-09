// The public face of the reactive engine.
//
//   state   — own a value
//   watch   — react to one; the returned function is the teardown
//   untrack — read a region without subscribing
//   scope   — one handle that disposes every watch created inside it
//
// `derive` (the argless memo) is not here: `memo` in `$shared/memo.ts` is its one public spelling,
// and there is deliberately no second name for "async memo". Everything else the engine exposes —
// `Node`, `internals` — is reachable only through `$shared/internal/graph.ts`, which is the seam
// `memo` sits on and nothing outside abide imports.

export {
    type Cell,
    type Memo,
    type State,
    scope,
    state,
    untrack,
    watch,
} from './internal/graph.ts'
