/*
The ONE document-order anchor-numbering rule, shared by every side that recovers a skeleton's
`<!--a-->` anchor positions. The same "why" — assign every block anchor, slot, and
interleaved-reactive-text part a position in document order, recover it on the other side — was
computed twice with no shared definition: `skeletonContext` re-derived it over the template AST
(assigning `anIndex`), `scanAnchors` re-derived it over the realized DOM (collecting the live
`a` comments). Each hand-mirrored the same traversal, so a change to one drifted silently from
the other — the index-desync class the runtime anchor guards exist to catch.

This module owns the traversal SHAPE as a sibling-list scan. A per-substrate
`AnchorWalkAdapter` classifies each node it meets into one of three roles, and that
classification — plus the document-order scan over it — IS the shared rule. The two substrates
differ only in how a fresh-context region is delimited (a control-flow/component/slot SUBTREE on
the AST side; a `[`…`]` / `abide:` marker-bracketed sibling RUN on the realized-DOM side), so
the adapter, not this walk, skips the region; the walk guarantees both sides emit the same
positions in the same order.
*/

/* What a node contributes as the scan reaches it, in document order. */
export type AnchorRole =
    /* Emit this node's anchor positions (zero or more — a reactive text node carries one per
       non-static part), then do NOT descend. A block/component/slot is itself one anchor whose
       body is a fresh context; an interleaved reactive text node is several. */
    | { kind: 'anchor'; positions: readonly object[] }
    /* An own-skeleton container — descend into its children, contributing no anchor itself (a
       static/host element). */
    | { kind: 'recurse' }
    /* Contribute nothing and do not descend — a static text leaf, a script/style, or a
       boundary the adapter handles out-of-band (range markers on the DOM side). */
    | { kind: 'skip' }

/* The single substrate fact the shared walk needs: classify a node. The adapter owns substrate
   detail (what an anchor is, what a fresh-context boundary is, how to reach children); the walk
   owns only document order. */
export type AnchorWalkAdapter<TNode> = {
    classify: (node: TNode) => AnchorRole
    childrenOf: (node: TNode) => readonly TNode[]
}

/* Scan `nodes` in document order, calling `emit` once per anchor position in the order both
   sides must agree on. Pure: the adapter decides roles, this owns only the order. */
export function walkAnchorOrder<TNode>(
    nodes: readonly TNode[],
    adapter: AnchorWalkAdapter<TNode>,
    emit: (position: object) => void,
): void {
    for (const node of nodes) {
        const role = adapter.classify(node)
        if (role.kind === 'anchor') {
            for (const position of role.positions) {
                emit(position)
            }
        } else if (role.kind === 'recurse') {
            walkAnchorOrder(adapter.childrenOf(node), adapter, emit)
        }
    }
}
