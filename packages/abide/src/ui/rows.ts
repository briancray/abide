import { REGION_CLOSE, ROW_OPEN } from '#shared/ANCHORS.ts'
import { leave } from './leave.ts'
import { moveNode } from './moveNode.ts'
import { closeOf, opensRegion, type Region, removeUntil } from './regions.ts'

// WHAT A ROW IS IN THE DOCUMENT, decided here and nowhere else. A row is its ELEMENT where the
// body has one; a body with several top-level nodes — `<dt>{k}</dt><dd>{v}</dd>` — is the RANGE
// from its `ROW_OPEN` anchor to the next row's anchor or the region's close, as a region is its
// pair. A range rather than the nodes `make` handed back: a region at the row's top level fills
// AFTER the row is made, and a row held as that array moved without the arm's content.
//
// AN ANCHOR IS A COMMENT AND A SINGLE ROOT IS AN ELEMENT, so a row's first node says which kind of
// row it is and no flag is carried beside it.

/**
 * The anchor ending the anchored row whose first node is `first`: the next `ROW_OPEN` or
 * `REGION_CLOSE` at the row's own depth, or null where there is none in this parent.
 *
 * A region nested in the row is stepped over whole (`closeOf`), so a `{#for}` inside one — whose
 * rows carry anchors of their own — is never mistaken for this row's end.
 */
function rowEnd(first: Node): Comment | null {
    for (
        let node: Node | null = first.nextSibling;
        node !== null;
        node = node.nextSibling
    ) {
        if (node.nodeType !== 8) continue
        const data = (node as Comment).data
        if (data === ROW_OPEN || data === REGION_CLOSE) return node as Comment
        if (opensRegion(data)) {
            node = closeOf(node)
            if (node === null) return null
        }
    }
    return null
}

/** Removes a row's nodes, from its first node to its end. */
export function removeRow(first: ChildNode): void {
    if (first.nodeType !== 8) {
        leave(first)
        return
    }
    removeUntil(first, rowEnd(first))
}

/**
 * Moves a row's nodes, first to last, to before `before` through `moveNode`.
 *
 * TO THE LAST NODE RATHER THAN TO THE ROW'S END: a row moved before its own end puts each node it
 * moves between its tail and the end, so the sibling after the tail is the row's own anchor again
 * by the time the walk reaches it.
 */
export function moveRow(
    parent: Node,
    first: ChildNode,
    before: Node | null,
): void {
    if (first.nodeType !== 8) {
        moveNode(parent, first, before)
        return
    }
    const end = rowEnd(first)
    const last = end === null ? parent.lastChild : end.previousSibling
    let node = first
    for (;;) {
        const next = node.nextSibling as ChildNode
        moveNode(parent, node, before)
        if (node === last) return
        node = next
    }
}

/**
 * The first node of each row the server painted in `region`.
 *
 * Each element between the region's anchors, or each `ROW_OPEN` standing at the region's own depth
 * — a `{#for}` nested in a row's arm carries anchors of its own, one depth down.
 */
export function rowsIn(region: Region, anchored: boolean): ChildNode[] {
    const found: ChildNode[] = []
    if (anchored) {
        for (
            let node = rowEnd(region.open);
            node !== null && node !== region.close;
            node = rowEnd(node)
        )
            found.push(node)
        return found
    }
    for (
        let node = region.open.nextSibling;
        node !== null && node !== region.close;
        node = node.nextSibling
    )
        if (node.nodeType === 1) found.push(node)
    return found
}
