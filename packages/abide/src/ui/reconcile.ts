import type { Region } from './regionAt.ts'

// 41.9 — a KEYED list, reconciled by moving the nodes that are already there rather than by
// rebuilding them. A rebuild produces the right screen and the wrong document: focus, selection,
// scroll position and anything a row was in the middle of go with the nodes that were replaced.
//
// ONE ROOT ELEMENT PER ROW, which is what lets a list carry no per-row marker. The row IS its
// element, so the nodes between the region's anchors ARE the rows and nothing has to be added to
// tell them apart. A body with two roots has no such node and is refused by the compiler rather
// than given an anchor nobody measured the cost of.

export type Row = {
    key: unknown
    // The value the row was built from. A row that survives a reorder keeps its NODES, which is
    // the whole point — but if the value behind that key is a different object, its content is
    // stale and the row is remade. Identity is the signal here, the inverse of the case where a
    // freshly built wrapper defeats one.
    data: unknown
    node: Element
    stop: () => void
}

export function rowsIn(region: Region): Element[] {
    const found: Element[] = []
    for (
        let node = region.open.nextSibling;
        node !== null && node !== region.close;
        node = node.nextSibling
    )
        if (node.nodeType === 1) found.push(node as Element)
    return found
}

// The list, after. `make` builds a row's element for a key it has not seen; `mount` wires one and
// hands back its disposer. Rows that survive are MOVED, never remade.
export function reconcile(
    region: Region,
    current: Row[],
    keys: unknown[],
    data: unknown[],
    make: (at: number) => Element,
    mount: (node: Element, at: number) => () => void,
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
            if (existing.node !== cursor)
                parent.insertBefore(existing.node, cursor)
            else cursor = cursor.nextSibling
            next.push(existing)
            continue
        }
        // Either a key never seen, or one whose value is a different object — both are a row
        // this document does not have, and both are made.
        const stale = held.get(key)
        if (stale !== undefined) {
            held.delete(key)
            stale.stop()
            stale.node.remove()
        }
        const node = make(at)
        parent.insertBefore(node, cursor)
        next.push({ key, data: data[at], node, stop: mount(node, at) })
    }

    // What the new order did not ask for. Stopped before removal, so a binding cannot wake over a
    // node that is already gone.
    for (const row of held.values()) {
        row.stop()
        row.node.remove()
    }
    return next
}
