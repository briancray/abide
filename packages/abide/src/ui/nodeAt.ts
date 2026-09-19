import { Mismatch } from './Mismatch.ts'
import {
    childOf,
    endOf,
    nodeAfter,
    parentOf,
    type Root,
    regionAt,
} from './regionAt.ts'

// WHERE A BINDING'S NODE IS, walked from the region root by the child indices the compiler
// recorded. Nothing is added to the document to make this work: no marker, no attribute, no
// wrapper — so a compiled page answers `querySelector`, `childNodes` and every CSS selector
// exactly as the page an author wrote does.
//
// A NEGATIVE STEP IS A REGION REFERENCE — `-1 - n` is region n directly inside whatever the walk
// has reached, and the step after it is how many nodes past that region's closing anchor to
// count. It stands WHEREVER a sibling follows a region, which is anywhere in a path and not only
// at its head: `<div>x{#if a}…{/if}<em>{v}</em></div>` addresses that slot `[0,-1,0,0]`. Decoded
// here rather than by the emitter, so one walk understands every path a plan can hold.
//
// THE KIND IS CHECKED, and that is the price of the scheme. Addressing by position is SILENT when
// it is wrong: a server and a client that disagree about the tree bind to whatever is at the
// index, and the page goes on rendering the wrong values with nothing saying so. Checking that a
// text binding found a text node and a listener found an element catches the gross case — a
// region of a different shape — for one `nodeType` read per binding at mount.

// The shared walk a region's bindings start from: each anchor `hoistPaths` emits, so bindings
// do not each walk from the region root.
export function childAt(root: Root, path: number[]): Node {
    const node = walk(root, path)
    if (node === undefined) throw noNode(path)
    return node
}

// Where a path LANDS, which is not always a node. A run every part of which is an expression
// renders NOTHING when every one of them is empty, so what a text binding needs is the position
// its node belongs at rather than whatever moved up into it — and every index after that position
// in the same parent is short by one until the node is back. `blank` is the compiler saying which
// runs can be in that state; for every other run a node of the wrong kind is a mismatch and is
// refused, which is the check this scheme is worth nothing without.
export function textAt(root: Root, path: number[], blank = false): Text {
    // The last STEP is the position and everything before it locates what holds the position. A
    // region reference is TWO numbers, so the split is by kind rather than by a fixed one.
    const back =
        path.length >= 2 && (path[path.length - 2] as number) < 0 ? 2 : 1
    // WALKED TO A LENGTH rather than over a slice: a slice is an array allocated per binding for a
    // bound the loop can take.
    const holder = reach(root, path, path.length - back)
    if (holder === undefined) throw noNode(path)

    // Where the position is: the node standing there, and what a missing one is put back into.
    const last = path[path.length - back] as number
    const region = last < 0 ? regionAt(holder, -1 - last) : undefined
    const found =
        region === undefined
            ? childOf(holder, last)
            : nodeAfter(region, path[path.length - 1] as number)
    if (found !== undefined && found.nodeType === 3) return found as Text
    const parent =
        region === undefined ? parentOf(holder) : region.close.parentNode
    if (!blank || parent === null) throw wrongKind(path, found)
    const text = insertText(
        parent,
        found ?? (region === undefined ? endOf(holder) : null),
    )
    // A ROW'S NODES ARE THE ROW, and the reconcile moves and removes exactly what that array holds
    // — so a node put into the document goes into the array too, whether the position was reached
    // through a region or not, or the row leaves part of itself behind on the first reorder.
    rowHolds(holder, text, found)
    return text
}

export function elementAt(root: Root, path: number[]): Element {
    const node = walk(root, path)
    if (node === undefined || node.nodeType !== 1)
        throw new Mismatch(
            `abide: [${path.join(',')}] is ${node === undefined ? 'missing' : node.nodeName} where this listener's element was rendered, so the client and the server disagree about this region's shape (41.11).`,
        )
    return node as Element
}

// A row root holds its own nodes, so one inserted into the run has to land in the array at the
// position it took in the document. `before` outside the row — the next row's first node, or the
// region's closing anchor — means the insert went at the row's end.
function rowHolds(root: Root, text: Text, before: Node | undefined): void {
    if (!Array.isArray(root)) return
    const at = before === undefined ? -1 : root.indexOf(before)
    if (at === -1) root.push(text)
    else root.splice(at, 0, text)
}

function insertText(parent: Node, before: Node | null): Text {
    const document = parent.ownerDocument ?? (parent as Document)
    const text = document.createTextNode('')
    parent.insertBefore(text, before as ChildNode | null)
    return text
}

function noNode(path: number[]): Mismatch {
    return new Mismatch(
        `abide: no node at [${path.join(',')}], so the client and the server disagree about this region's shape (41.11).`,
    )
}

function wrongKind(path: number[], found: Node | undefined): Mismatch {
    return new Mismatch(
        `abide: [${path.join(',')}] is ${found === undefined ? 'missing' : `a ${found.nodeName}`} where this binding's text was rendered, so the client and the server disagree about this region's shape (41.11).`,
    )
}

function walk(root: Root, path: number[]): Node | undefined {
    const found = reach(root, path, path.length)
    if (found === undefined || Array.isArray(found)) return undefined
    return 'nodeType' in found ? found : undefined
}

// The walk itself, which answers a ROOT rather than a node: no steps is the root, and a root is
// not always a node. `stop` is how far down the path to go.
function reach(root: Root, path: number[], stop: number): Root | undefined {
    let here: Root | undefined = root
    let at = 0
    while (at < stop) {
        if (here === undefined) return undefined
        const index = path[at] as number
        if (index < 0) {
            here = nodeAfter(regionAt(here, -1 - index), path[at + 1] ?? 0)
            at += 2
            continue
        }
        here = childOf(here, index)
        at += 1
    }
    return here
}
