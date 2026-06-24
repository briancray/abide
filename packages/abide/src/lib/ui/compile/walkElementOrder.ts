/*
The ONE pre-order element-hole numbering rule, shared by every side that positions a skeleton's
located elements. The same "why" — number the bound elements in pre-order, recover them on the
other side — was computed twice with no shared definition: `skeletonContext` threaded an `el`
counter over the template AST (assigning `elIndex`), `indexElementHoles` re-walked the parsed
skeleton DOM (recording each `HOLE_ATTRIBUTE` element's path). Each hand-mirrored the same
element-only pre-order, so a change to one drifted silently from the other — the index-desync
class `resolveElementHole` exists to catch.

This module owns the traversal SHAPE: an element-only pre-order over a sibling list, threading
an element-only path. A per-substrate `ElementWalkAdapter` classifies each node — a numbered
element (a hole emits, all elements descend) or a skip (non-element / fresh-context boundary) —
and that classification, plus the path-threading scan over it, IS the shared rule. The two
substrates differ only in what marks a hole (a reactive attr/text-leaf on the AST side, the
`HOLE_ATTRIBUTE` on the parsed-DOM side) and where a fresh context begins (a control-flow/
component/slot SUBTREE on the AST side; the parsed skeleton already prunes those to `<!--a-->`
anchors, so the DOM side only meets its own elements), which the adapter owns — the walk
guarantees both number the same elements in the same element-only order.
*/

/* What a node contributes as the pre-order scan reaches it. */
export type ElementRole =
    /* An element in this skeleton: it consumes an element-only index (so a later sibling's
       path stays stable), emits its hole position when `isHole`, and is descended into. */
    | { kind: 'element'; isHole: boolean }
    /* A non-element (text/comment) or a fresh-context boundary (control-flow/component/slot):
       contributes no index, no hole, and is not descended. */
    | { kind: 'skip' }

/* The substrate facts the shared walk needs: classify a node, reach its children. The adapter
   owns substrate detail (what an element hole is, how to reach children); the walk owns only
   the element-only pre-order and the path it threads. */
export type ElementWalkAdapter<TNode> = {
    classify: (node: TNode) => ElementRole
    childrenOf: (node: TNode) => readonly TNode[]
}

/* Scan `nodes` in element-only pre-order, calling `emit` once per hole with its element-only
   path — the order and path both sides must agree on. Pure: the adapter decides roles, this
   owns only the order and the path prefix. */
export function walkElementOrder<TNode>(
    nodes: readonly TNode[],
    adapter: ElementWalkAdapter<TNode>,
    emit: (node: TNode, path: number[]) => void,
    prefix: number[] = [],
): void {
    let elementIndex = 0
    for (const node of nodes) {
        const role = adapter.classify(node)
        if (role.kind === 'skip') {
            continue
        }
        const path = [...prefix, elementIndex]
        elementIndex += 1
        if (role.isHole) {
            emit(node, path)
        }
        walkElementOrder(adapter.childrenOf(node), adapter, emit, path)
    }
}
