/*
A node in the reactive graph. A signal has a value and no compute; a computed
has both; an effect has a compute and runs for its side effects. `deps` are the
nodes this node read on its last run, `observers` are the nodes that read this
one — kept in both directions so a write can walk forward to dependents and a
recompute can drop stale back-links.
*/
export type ReactiveNode = {
    value: unknown
    compute: (() => unknown) | undefined
    deps: Set<ReactiveNode>
    observers: Set<ReactiveNode>
    dirty: boolean
    isEffect: boolean
}
