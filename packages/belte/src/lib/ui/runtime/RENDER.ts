/*
Render mode shared by the dom helpers. In the default (create) mode `hydration`
is undefined and helpers build fresh nodes. During `hydrate`, it holds a
per-parent claim index so helpers adopt the existing server-rendered nodes
instead — the open-child / append-text / append-static helpers each advance the
same index in build order (which matches the SSR order), so element and text
nodes are claimed in lockstep with how they were emitted.
*/
export const RENDER: { hydration: { index: Map<Node, number> } | undefined } = {
    hydration: undefined,
}
