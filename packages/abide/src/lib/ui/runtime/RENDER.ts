/*
Render mode shared by the dom helpers. In the default (create) mode `hydration`
is undefined and helpers build fresh nodes. During `hydrate` it holds, per parent,
the next server-rendered child node to claim — a node pointer (not an index) so it
survives nodes a block inserts (anchors) mid-hydration. Helpers claim in build
order, which matches the SSR order, advancing the pointer to the next sibling.

`blockCounters`/`depth` drive the render-pass block-id counters: every `await`/`try`
block draws a path-namespaced id via `nextBlockId` (ADR-0037) — `blockCounters` maps
each render-path to its own 0,1,2… sequence, counted in document order within that
path. Namespacing by path (not one flat counter shared across a component and the
children it inlines) is what keeps ids congruent SSR↔client even when sibling child
renders run concurrently on the server; the client mounts each child synchronously
under the same path, so both sides compose the same ids (`RESUME` is keyed by them).
`depth` tracks nesting so the OUTERMOST render/mount clears the map and a child render/
mount continues it. See `enterRenderPass`/`nextBlockId`.

`namespace` is the ambient foreign-content namespace (SVG/MathML) a control-flow block
sets from its insertion parent while building into a detached fragment, so foreign
elements built there get the right namespace — the fragment itself carries none. It is
undefined outside foreign content. See `enterNamespace`/`effectiveChildNamespace`.
*/
export const RENDER: {
    hydration: { next: Map<Node, Node | null> } | undefined
    blockCounters: Map<string, number>
    depth: number
    namespace: string | undefined
} = {
    hydration: undefined,
    blockCounters: new Map(),
    depth: 0,
    namespace: undefined,
}
