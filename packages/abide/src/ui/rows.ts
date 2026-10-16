import { REGION_CLOSE, ROW_OPEN } from '#shared/ANCHORS.ts'
import { moveItem, rowItem } from '#shared/reactive/index.ts'
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
     * The value the row shows.
     *
     * A KEPT KEY KEEPS ITS ROW (32.67): a different value under it is written here and into the
     * row's bindings rather than remaking the row, so identity decides whether there is anything to
     * write, not whether the row survives.
     */
    data: unknown
    /**
     * The row's item as a cell (`rowCell`), or null where nothing the row binds reads it through
     * one yet.
     *
     * MADE ONLY WHERE A BINDING NEEDS IT: a slot that reads the item and nothing else is written by
     * `update`, and a binding at the row's top level reads the record until the row's first new
     * item (`updateRow`), so a row that never takes one allocates nothing for 32.67.
     */
    item: (() => unknown) | null
    /** Rewrites the row's slots that read its item alone (`RowBuilders.update`). */
    update: (row: Row, at: number) => void
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
     * The patch epoch the row last took its item at (32.33).
     *
     * Its item written past this is content the row never saw, under the same object a kept row is
     * matched by.
     */
    seen: number
}

/**
 * A row's builders, each handed the row's RECORD — whose `data` is the item — so the one record
 * carries the item to all four, and a rebuilt row (41.10) writes its new first node back there.
 */
export type RowBuilders = {
    /**
     * A row's nodes, BUILT in the document the list stands in — handed over by the reconcile
     * rather than found by the row, which is the one place a row's document is decided. Every slot
     * reading the item alone is written here, before the nodes are inserted.
     */
    make: (document: Document, row: Row, at: number) => Node[]
    mount: (row: Row, at: number) => Scope
    /** 32.67 — rewrites, from `row.data`, the slots `make` wrote from the item alone. */
    update: (row: Row, at: number) => void
}

/** Answers the builders a row is made and mounted by; called once per row (14.8). */
export type RowSetUp = (row: Row, at: number) => RowBuilders

/** The `update` of a row that has no slot reading its item alone. */
export function noUpdate(): void {}

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
    setUp: RowSetUp,
    parent: Node,
    before: Node,
    key: unknown,
    data: unknown,
    at: number,
): Row {
    // `before` STANDS IN FOR THE ROW'S FIRST NODE until `make` hands it over, so the field holds a
    // node for the record's whole life.
    const row = newRow(key, data, before as ChildNode, at)
    // 14.8 — set up ONCE for the row, and the same builders make it and mount it.
    const builders = setUp(row, at)
    row.update = builders.update
    const nodes = builders.make(parent.ownerDocument as Document, row, at)
    for (const node of nodes) parent.insertBefore(node, before)
    row.node = nodes[0] as ChildNode
    row.scope = builders.mount(row, at)
    return row
}

/**
 * A row over nodes the server painted, set up and mounted.
 *
 * 41.8 — the hydration half of `makeRow`: the nodes are already in the document.
 */
export function paintedRow(
    setUp: RowSetUp,
    key: unknown,
    data: unknown,
    node: ChildNode,
    at: number,
): Row {
    const row = newRow(key, data, node, at)
    const builders = setUp(row, at)
    row.update = builders.update
    row.scope = builders.mount(row, at)
    return row
}

/**
 * The row's item as a cell its bindings read, made on the first ask (32.67).
 *
 * Asked by a row whose binding reads the item inside a region of its own, or a branch-local setup.
 */
export function rowCell(row: Row): () => unknown {
    let item = row.item
    if (item === null) {
        item = rowItem(row.data)
        row.item = item
    }
    return item
}

/**
 * The row's item as a binding at its own top level reads it (`Scope.itemWatch`): off the record
 * until the row has a cell, and through the cell from then on (32.67).
 */
export function itemOf(row: Row): unknown {
    const item = row.item
    return item === null ? row.data : item()
}

/**
 * Writes a kept key's new value into its row, which keeps its nodes (32.67).
 *
 * 32.33 — the same object a patch wrote inside is written too, and wakes the row's readers as a
 * different one would.
 *
 * THE CELL IS MADE ON THE FIRST NEW ITEM, not when the row is: a row's item watches read the record
 * until then (`itemOf`), so a row that never takes one allocates nothing for it. Made here, they
 * are rerun to read it, which is also what subscribes them to whatever the new item has them read.
 */
export function updateRow(row: Row, data: unknown): void {
    row.data = data
    if (row.item !== null) moveItem(row.item, data)
    else if (row.scope.items !== 0) {
        row.item = rowItem(data)
        row.scope.rerunItems()
    }
    row.update(row, row.at)
}

/**
 * A row's record, its shape fixed once for every path that makes one — a made row and a hydrated
 * one alike.
 */
function newRow(key: unknown, data: unknown, node: ChildNode, at: number): Row {
    return {
        key,
        data,
        item: null,
        update: noUpdate,
        node,
        // A `Scope` rather than `undefined` until the mount returns, so the field holds one class
        // for the record's whole life.
        scope: EMPTY_SCOPE,
        at,
        seen: PATCHES.epoch,
    }
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
