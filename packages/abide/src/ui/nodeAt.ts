// WHERE A BINDING'S NODE IS, walked from the region root by the child indices the compiler
// recorded. Nothing is added to the document to make this work: no marker, no attribute, no
// wrapper — so a compiled page answers `querySelector`, `childNodes` and every CSS selector
// exactly as the page an author wrote does.
//
// THE KIND IS CHECKED, and that is the price of the scheme. Addressing by position is SILENT when
// it is wrong: a server and a client that disagree about the tree bind to whatever is at the
// index, and the page goes on rendering the wrong values with nothing saying so. Checking that a
// text binding found a text node and a listener found an element catches the gross case — a
// region of a different shape — for one `nodeType` read per binding at mount.

// The shared walk a region's bindings start from. Emitted ONCE for the longest path prefix every
// binding has in common, because walking from the region root per binding is O(bindings x depth):
// measured at 13x a marker walk on a tree 32 deep, and flat against depth once hoisted.
export function childAt(root: Node, path: number[]): Node {
    const node = walk(root, path)
    if (node === undefined)
        throw new Error(
            `abide: no node at [${path.join(',')}], so the client and the server disagree about this region's shape (41.11).`,
        )
    return node
}

function walk(root: Node, path: number[]): Node | undefined {
    let node: Node | undefined = root
    for (let at = 0; at < path.length; at += 1) {
        if (node === undefined) return undefined
        node = node.childNodes[path[at] as number]
    }
    return node
}

export function textAt(root: Node, path: number[]): Text {
    const node = walk(root, path)
    // A run whose value rendered EMPTY leaves no text node behind, so one is made. Without this
    // the binding has nowhere to write and the region reads as a mismatch when it is merely blank.
    if (node === undefined) {
        const parent = walk(root, path.slice(0, -1))
        if (parent === undefined)
            throw new Error(
                `abide: no node at [${path.join(',')}], so the client and the server disagree about this region's shape (41.11).`,
            )
        const document = parent.ownerDocument ?? (parent as Document)
        const text = document.createTextNode('')
        parent.appendChild(text)
        return text
    }
    if (node.nodeType !== 3)
        throw new Error(
            `abide: [${path.join(',')}] is a ${node.nodeName} where this binding's text was rendered, so the client and the server disagree about this region's shape (41.11).`,
        )
    return node as Text
}

export function elementAt(root: Node, path: number[]): Element {
    const node = walk(root, path)
    if (node === undefined || node.nodeType !== 1)
        throw new Error(
            `abide: [${path.join(',')}] is ${node === undefined ? 'missing' : node.nodeName} where this listener's element was rendered, so the client and the server disagree about this region's shape (41.11).`,
        )
    return node as Element
}
