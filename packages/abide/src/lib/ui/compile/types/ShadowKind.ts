/*
Which deref a branch-local shadow name lowers to. A block value param either binds
as a reactive `.value` cell (`derived` — read as `name.value`, the client back-end's
keyed-each item / `await then` value) or as a plain JS local holding the resolved
value (`plain` — read as the bare identifier, the SSR back-end's inline `await` value
and both back-ends' snippet/catch params). A name MUST be registered under the kind
its emitted code reads it as, or it mis-lowers to the component signal it shadows.
*/
export type ShadowKind = 'derived' | 'plain'
