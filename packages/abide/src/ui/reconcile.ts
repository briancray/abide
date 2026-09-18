import { ROW_OPEN } from './REGION.ts'
import type { Region } from './regionAt.ts'

// 41.9 — a KEYED list, reconciled by moving the nodes that are already there rather than by
// rebuilding them. A rebuild produces the right screen and the wrong document: focus, selection,
// scroll position and anything a row was in the middle of go with the nodes that were replaced.
//
// A ROW IS ITS ELEMENT where the body has one, and that is what lets most lists carry no per-row
// marker at all: the nodes between the region's anchors ARE the rows. A body with SEVERAL top
// level nodes — `<dt>{k}</dt><dd>{v}</dd>`, which is ordinary HTML — has no such node, and gets
// one anchor per ROW. That is ~2.5 bytes gzipped a row, not the per-SLOT marker `benchGrid.ts`
// measured doubling a page.

export type Row = {
    key: unknown
    // The value the row was built from. A row that survives a reorder keeps its NODES, which is
    // the whole point — but if the value behind that key is a different object, its content is
    // stale and the row is remade. Identity is the signal here, the inverse of the case where a
    // freshly built wrapper defeats one.
    data: unknown
    // EVERY node of the row, in order. One element for the common single-root body; the row's
    // anchor and its whole content for a body with several.
    nodes: Node[]
    stop: () => void
}

export function rowsIn(region: Region, anchored: boolean): Node[][] {
    const found: Node[][] = []
    let current: Node[] | undefined
    for (
        let node = region.open.nextSibling;
        node !== null && node !== region.close;
        node = node.nextSibling
    ) {
        if (!anchored) {
            if (node.nodeType === 1) found.push([node])
            continue
        }
        if (node.nodeType === 8 && (node as Comment).data === ROW_OPEN) {
            current = [node]
            found.push(current)
            continue
        }
        current?.push(node)
    }
    return found
}

// The list, after. `make` builds a row's element for a key it has not seen; `mount` wires one and
// hands back its disposer. Rows that survive are MOVED, never remade.
export function reconcile(
    region: Region,
    current: Row[],
    keys: unknown[],
    data: unknown[],
    make: (at: number) => Node[],
    mount: (nodes: Node[], at: number) => () => void,
): Row[] {
    const held = new Map<unknown, Row>()
    for (const row of current) held.set(row.key, row)

    const next: Row[] = []
    const parent = region.close.parentNode
    if (parent === null) return current

    // Walk the wanted order and put each row where it belongs. A row already in the right place
    // is not touched at all — `insertBefore` on a node already at that position still counts as a
    // move in every engine's records, so the check is what makes "nodes moved" mean something.
    let cursor: ChildNode | null = region.open.nextSibling
    for (let at = 0; at < keys.length; at += 1) {
        const key = keys[at] as unknown
        const existing = held.get(key)
        if (existing !== undefined && existing.data === data[at]) {
            held.delete(key)
            // A row already in place is not touched: `insertBefore` on a node already there
            // still counts as a move in every engine's records.
            if (existing.nodes[0] !== cursor)
                for (const node of existing.nodes)
                    parent.insertBefore(node, cursor)
            else
                for (let step = 0; step < existing.nodes.length; step += 1)
                    cursor = cursor === null ? null : cursor.nextSibling
            next.push(existing)
            continue
        }
        // Either a key never seen, or one whose value is a different object — both are a row
        // this document does not have, and both are made.
        const stale = held.get(key)
        if (stale !== undefined) {
            held.delete(key)
            stale.stop()
            for (const node of stale.nodes) (node as ChildNode).remove()
        }
        const nodes = make(at)
        for (const node of nodes) parent.insertBefore(node, cursor)
        next.push({ key, data: data[at], nodes, stop: mount(nodes, at) })
    }

    // What the new order did not ask for. Stopped before removal, so a binding cannot wake over a
    // node that is already gone.
    for (const row of held.values()) {
        row.stop()
        for (const node of row.nodes) (node as ChildNode).remove()
    }
    return next
}
