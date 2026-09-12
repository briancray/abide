// THE HAND-WRITTEN DOM ARM. `signal.ts` is the floor for a wake; this is the floor for
// a rendered row, and the two are separate files for the same reason they are separate
// numbers — a reactive claim is a ratio against code doing the same job by hand, and
// the job here is touching nodes rather than propagating values.
//
// IT IS DELIBERATELY DUMB: an array, a host element, and the smallest write that does
// each job. No keying, no diffing, no scheduling. The moment it grows any of those it
// stops being the floor the machinery is budgeted against, and becomes a second
// implementation of the thing under test.
//
// WHY THE TEXT NODES COME BACK from `buildRows`. A hand-written arm that re-found its
// node per update would be measuring `querySelector`, and a per-row lookup is not what
// anybody writes twice — they keep the reference. Handing the array back is that,
// spelled so the case body can see it.

export type Row = {
    id: number
    label: string
    done: boolean
}

export function makeRows(count: number, from = 0): Row[] {
    const rows: Row[] = []
    for (let at = 0; at < count; at += 1)
        rows.push({ id: from + at, label: `row ${from + at}`, done: false })
    return rows
}

// One `<li>` per row with one text node in it, appended in order. Three nodes created
// per row in this arm: the element, the text node, and nothing else — a compiled arm
// makes a row by `cloneNode`, which is why `nodesCreated` counts both.
export function buildRows(host: Element, rows: readonly Row[]): Text[] {
    const labels: Text[] = []
    const document = host.ownerDocument
    for (let at = 0; at < rows.length; at += 1) {
        const row = rows[at] as Row
        const item = document.createElement('li')
        const label = document.createTextNode(row.label)
        item.appendChild(label)
        host.appendChild(item)
        labels.push(label)
    }
    return labels
}

// A `.data` write, GUARDED — the cheapest thing a hand-written arm does and the one an
// unguarded framework arm loses to. `redundantDataWrites` is the row that sees the
// difference, so the floor has to take the guard or the comparison flatters the arm
// under test.
export function setLabel(node: Text, text: string): void {
    if (node.data !== text) node.data = text
}

export function setSelected(item: Element, on: boolean): void {
    if (on) item.classList.add('selected')
    else item.classList.remove('selected')
}

// A move, by the only means there is: `insertBefore` of the node already in the tree.
export function moveRow(host: Element, from: number, to: number): void {
    const children = host.children
    const moving = children[from]
    if (moving === undefined) return
    host.insertBefore(moving, children[to] ?? null)
}

export function removeLast(host: Element, count: number): void {
    for (let at = 0; at < count; at += 1) {
        const last = host.lastElementChild
        if (last === null) return
        last.remove()
    }
}

// A KEYED RECONCILE, hand-written and minimal: walk the wanted order, and where the
// node in hand is not the one already at the cursor, put it there. That is what a
// person writes when they need a list to match an array, and it is the floor a compiled
// reconcile is priced against — not a good algorithm, the obvious one.
//
// It moves 1 node for an adjacent swap, 2 for a swap across the list, and n-1 for a
// full reverse. Correct for ANY permutation, which is the property the two cases need:
// the swap prices it and the reverse is what catches a transposition that happens to
// leave both ends right.
export function reconcile<Key>(
    host: Element,
    nodes: ReadonlyMap<Key, Element>,
    order: readonly Key[],
): void {
    let cursor = host.firstElementChild
    for (let at = 0; at < order.length; at += 1) {
        const node = nodes.get(order[at] as Key)
        if (node === undefined) continue
        if (node === cursor) {
            cursor = cursor.nextElementSibling
            continue
        }
        host.insertBefore(node, cursor)
    }
}

// The order actually in the document, by key — for comparing the WHOLE result rather
// than its ends.
export function orderOf<Key>(
    host: Element,
    keyOf: (element: Element) => Key,
): Key[] {
    const out: Key[] = []
    for (let child = host.firstElementChild; child !== null; child = child.nextElementSibling)
        out.push(keyOf(child))
    return out
}
