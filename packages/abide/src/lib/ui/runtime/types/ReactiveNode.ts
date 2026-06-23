import type { ReactiveLink } from './ReactiveLink.ts'

/*
A node in the reactive graph. A signal has a value and no compute; a computed has
both; an effect has a compute and runs for its side effects. Dependencies (the
nodes this node read on its last run) and subscribers (the nodes that read this
one) are each held as an intrusive doubly-linked list of `ReactiveLink` edges
rather than a `Set` — a write walks `subsHead → nextSub` forward to dependents, a
recompute walks `depsHead → nextDep` to reuse still-live edges and drop stale
back-links, both O(1) per edge with no allocation once the node settles.

`depsTail` doubles as the recompute cursor: `runNode` rewinds it before compute
and `track` advances it past each reused edge, so whatever trails it afterward is
this run's stale dependencies, trimmed in one pass.
*/
export type ReactiveNode = {
    value: unknown
    compute: (() => unknown) | undefined
    depsHead: ReactiveLink | undefined
    depsTail: ReactiveLink | undefined
    subsHead: ReactiveLink | undefined
    subsTail: ReactiveLink | undefined
    /* The node's settle-state for push-pull propagation: CLEAN / CHECK / DIRTY (see
       NODE_STATE). A signal is always CLEAN (no compute); a computed is born DIRTY and
       cycles CLEAN→CHECK/DIRTY→CLEAN as deps change and reads settle it. */
    status: number
    isEffect: boolean
}
