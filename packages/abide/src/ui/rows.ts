import { REGION_CLOSE, ROW_OPEN } from '#shared/ANCHORS.ts'
import { PATCHES } from '#shared/reactive/PATCHES.ts'
import { leave } from './leave.ts'
import { moveNode } from './moveNode.ts'
import { closeOf, opensRegion, type Region, removeUntil } from './regions.ts'
import { EMPTY_SCOPE, type Scope } from './Scope.ts'

// WHAT A ROW IS — its record, how it is made, mounted, rebuilt and dropped, and what it is in the
// document — decided here and nowhere else. `reconcile.ts` decides only WHICH rows move. A row is its ELEMENT where the
// body has one; a body with several top-level nodes — `<dt>{k}</dt><dd>{v}</dd>` — is the RANGE
// from its `ROW_OPEN` anchor to the next row's anchor or the region's close, as a region is its
// pair. A range rather than the nodes `make` handed back: a region at the row's top level fills
// AFTER the row is made, and a row held as that array moved without the arm's content.
//
// AN ANCHOR IS A COMMENT AND A SINGLE ROOT IS AN ELEMENT, so a row's first node says which kind of
// row it is and no flag is carried beside it.

export type Row = {
    key: unknown
    /**
     * The value the row was built from.
     *
     * A row that survives a reorder keeps its NODES, which is the whole point — but if the value
     * behind that key is a different object, its content is stale and the row is remade. Identity
     * is the signal here, the inverse of the case where a freshly built wrapper defeats one.
     */
    data: unknown
    /**
     * The row's first node: its element, or its `ROW_OPEN` anchor where the body has several —
     * the start of a range, not the nodes `make` handed back.
     */
    node: ChildNode
    /** The row's bindings, stopped when it leaves. */
    scope: Scope
    /**
     * Where this row stood in the list the document currently shows.
     *
     * The placement walk needs "already in order" to be a question about POSITIONS rather than
     * about nodes, and asking the document — `compareDocumentPosition`, or counting siblings — is
     * the walk this exists to avoid. Written by every reconcile, so it is a fact about the last one
     * rather than about the caller, and a hydration seed sets it because that IS the order the
     * server painted.
     */
    at: number
    /**
     * The patch epoch the row was made at (32.33).
     *
     * Its item written past this is content the row never saw, under the same object a kept row is
     * matched by.
     */
    seen: number
}

export type RowBuilders = {
    /**
     * A row's nodes, BUILT in the document the list stands in — handed over by the reconcile
     * rather than found by the row, which is the one place a row's document is decided.
     */
    make: (document: Document, item: unknown, at: number) => Node[]
    /**
     * Handed the row's RECORD rather than its nodes: a row it rebuilds (41.10) writes its new
     * first node back there.
     */
    mount: (row: Row, item: unknown, at: number) => Scope
}

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
function removeRow(first: ChildNode): void {
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

/**
 * Rebuilds a row in place from `next`, keeping its record.
 *
 * 41.10 — a row that cannot be hydrated is rebuilt: the fresh nodes go where the row stood and the
 * row's record takes the new first node, so the reconcile still reaches all of it.
 */
export function replaceRow(row: Row, next: Node[]): void {
    const first = row.node
    const parent = first.parentNode
    if (parent === null) return
    for (const node of next) parent.insertBefore(node, first)
    removeRow(first)
    row.node = next[0] as ChildNode
}

/** A new row, built and inserted before `before`. */
export function makeRow(
    setUp: (item: unknown, at: number) => RowBuilders,
    parent: Node,
    before: Node,
    key: unknown,
    item: unknown,
    at: number,
): Row {
    // 14.8 — set up ONCE for the row, and the same builders make it and mount it.
    const builders = setUp(item, at)
    const nodes = builders.make(parent.ownerDocument as Document, item, at)
    for (const node of nodes) parent.insertBefore(node, before)
    return rowOf(builders, key, item, nodes[0] as ChildNode, at)
}

/**
 * A row record over nodes already in the document, mounted.
 *
 * The one place a row's record is written, so its shape is fixed once for every path that makes one
 * — a made row and a hydrated one alike. The mount is handed the RECORD, because a row it rebuilds
 * (41.10) has a new first node to write back.
 */
export function rowOf(
    builders: RowBuilders,
    key: unknown,
    item: unknown,
    node: ChildNode,
    at: number,
): Row {
    const row: Row = {
        key,
        data: item,
        node,
        // A `Scope` rather than `undefined` until the mount returns, so the field holds one class
        // for the record's whole life.
        scope: EMPTY_SCOPE,
        at,
        seen: PATCHES.epoch,
    }
    row.scope = builders.mount(row, item, at)
    return row
}

/**
 * Stops a row's bindings, then removes its nodes.
 *
 * Stopped first, so a binding cannot wake over a node that is already gone.
 */
export function dropRow(row: Row): void {
    row.scope.stop()
    removeRow(row.node)
}
