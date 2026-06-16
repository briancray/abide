/*
Render mode shared by the dom helpers. In the default (create) mode `hydration`
is undefined and helpers build fresh nodes. During `hydrate` it holds, per parent,
the next server-rendered child node to claim — a node pointer (not an index) so it
survives nodes a block inserts (anchors) mid-hydration. Helpers claim in build
order, which matches the SSR order, advancing the pointer to the next sibling.

`blockId`/`depth` drive the render-pass block-id counter: every `await`/`try` block
draws an id from `blockId` in document order, shared across a component and the
child components it inlines, so ids are globally unique within one render pass (the
SSR stream and client hydration agree on them — `RESUME` is keyed by id). `depth`
tracks nesting so the OUTERMOST render/mount resets the counter and a child render/
mount continues it. See `enterRenderPass`/`nextBlockId`.
*/
export const RENDER: {
    hydration: { next: Map<Node, Node | null> } | undefined
    blockId: number
    depth: number
} = {
    hydration: undefined,
    blockId: 0,
    depth: 0,
}
