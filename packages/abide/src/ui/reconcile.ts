import type { List } from './List.ts'
import { ROW_OPEN } from './REGION.ts'
import type { Region } from './regionAt.ts'
import type { Scope } from './Scope.ts'

// 41.8 — a KEYED list, reconciled by moving the nodes that are already there rather than by
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
    // The row's bindings, stopped when it leaves.
    scope: Scope
    // Where this row stood in the list the document currently shows. The placement walk needs
    // "already in order" to be a question about POSITIONS rather than about nodes, and asking the
    // document — `compareDocumentPosition`, or counting siblings — is the walk this exists to
    // avoid. Written by every reconcile, so it is a fact about the last one rather than about the
    // caller, and a hydration seed sets it because that IS the order the server painted.
    at: number
}

// 41.10 — a row that cannot be hydrated is REBUILT, and a row IS its nodes: the reconcile moves
// and removes exactly what this array holds, so a replacement has to land in the ARRAY as well as
// in the document or the row leaves half of itself behind on the first reorder.
export function replaceNodes(nodes: Node[], next: Node[]): void {
    const first = nodes[0] ?? null
    const parent = first === null ? null : first.parentNode
    if (parent === null) return
    for (const node of next) parent.insertBefore(node, first as ChildNode)
    for (const node of nodes) (node as ChildNode).remove()
    nodes.length = 0
    for (const node of next) nodes.push(node)
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

// The list, after. `make` builds a row's nodes for a key it has not seen; `mount` wires one and
// hands back its disposer. Rows that survive are MOVED, never remade.
export function reconcile(list: List, data: unknown[]): void {
    const region = list.region
    const current = list.rows
    const wanted = data.length
    const keys = new Array<unknown>(wanted)
    for (let at = 0; at < wanted; at += 1) keys[at] = list.key(data[at], at)
    const held = new Map<unknown, Row>()
    // 41.14 — A KEY THE LIST REPEATS IS STILL A ROW, and the map cannot hold two under one key.
    // Overwritten silently, the shadowed row became unreachable from `held`, from `next` and from
    // the cleanup below: its `stop` was never called, so its readers woke on every write for the
    // life of the page and wrote into nodes still standing in the document, and the list grew by
    // one on every reconcile.
    //
    // LAST WINS, which is what the map already did — the fix is what happens to the row it
    // shadows, not which of the two the walk reconciles. Held aside rather than in a per-key
    // array, which would allocate one a row on a path walked per row for a case no list should
    // have.
    let shadowed: Row[] | null = null
    for (const row of current) {
        const previous = held.get(row.key)
        if (previous !== undefined) {
            if (shadowed === null) shadowed = []
            shadowed.push(previous)
        }
        held.set(row.key, row)
    }

    // SIZED UP FRONT because it is filled from the END: the first store into an empty array at a
    // high index is a sparse array, and `next` is the next reconcile's `current`.
    const next = new Array<Row>(wanted)
    const parent = region.close.parentNode
    if (parent === null) return

    // BEFORE THE ANCHORS ARE TAKEN, and that ordering is the whole of it: a shadowed row stands
    // EARLIER in the document than the row that won its key, so dropping it after the placement
    // walk would pull a node the walk is resting on out from under it.
    if (shadowed !== null) {
        warnRepeatedKey(list)
        for (const row of shadowed) dropRow(row)
    }

    // RESOLVE EVERY WANTED ROW BEFORE MOVING ANY NODE. A single forward pass that moves as it
    // decides cannot know whether the row it is about to move is the one that should move: it
    // sees a row that is not where it wants it and moves it, and if the node it was resting on
    // belongs LATER in the wanted order every row between the two is moved past it too.
    // Measured, on 200 rows: swapping the 2nd and the 198th moved 197 elements where 2 are
    // needed, and cost more wall clock (30.4 µs) than reversing the whole list (29.2 µs).
    // Reordering two rows was dearer than reordering every row.
    //
    // NOTHING ABOUT THE OUTPUT SHOWS IT — the document is correct either way, which is why
    // `list.test.ts` was green: it asserts a two-row ADJACENT swap moves one element, and that
    // case the forward walk gets right. So this is gated as a COUNT, per case shape, carrying the
    // numbers the forward walk reported.
    // Its index in `current` for a row that survives, -1 for one this document does not have. A
    // plain array rather than a typed one: it is allocated per reconcile, and an Int32Array's
    // construction is not repaid at the sizes a list reaches.
    const from: number[] = []
    const survivor: (Row | null)[] = []
    // Whether every survivor already stands in the wanted order, asked while `from` is built.
    let ordered = true
    let lastSurvivor = -1
    for (let at = 0; at < wanted; at += 1) {
        const key = keys[at] as unknown
        const existing = held.get(key)
        // `Object.is` RATHER THAN `===`, for NaN: `NaN === NaN` is false, so a row whose value is
        // NaN never matched itself and was stopped, removed and remade on every reconcile —
        // taking its focus, selection, scroll position and any transition mid-flight with it —
        // while the text on screen stayed identical, so nothing about the output could show it.
        if (existing !== undefined && Object.is(existing.data, data[at])) {
            held.delete(key)
            survivor.push(existing)
            from.push(existing.at)
            if (existing.at < lastSurvivor) ordered = false
            lastSurvivor = existing.at
            continue
        }
        // Either a key never seen, or one whose value is a different object — both are a row this
        // document does not have, and both are made. A stale one's nodes go NOW: the placement
        // walk anchors on nodes that are still attached, and a node about to be replaced is not
        // one of them.
        if (existing !== undefined) {
            held.delete(key)
            dropRow(existing)
        }
        survivor.push(null)
        from.push(-1)
    }

    // THE ROWS THAT NEED NOT MOVE ARE THE LONGEST RUN ALREADY IN ORDER. Every survivor outside it
    // moves exactly once, and that is the minimum: a row is in its final relative position or it
    // is not. O(n log n) over the survivors against a walk that could move n.
    //
    // NOTHING MOVED IS THE COMMON SHAPE — an append, a removal, a row's value changing — and then
    // the run is every survivor, which the loop above already knows. Skipping the patience sort
    // there measured in Chromium, on a reconcile that moves nothing: 48 -> 38 µs at 1,000 rows and
    // 630 -> 540 µs at 10,000, over two runs each. Under a frame either way — what it buys is the
    // three allocations per reconcile the sort makes, on the reconcile most lists run.
    const keep = ordered ? null : longestRun(from)

    // BACKWARDS, because the anchor a row is placed before is the row that FOLLOWS it, and by the
    // time the walk reaches one that row is either already placed or still standing where it was.
    // Forwards, the anchor is whatever happens to be next in a document the walk is rewriting.
    let anchor: ChildNode | null = region.close
    for (let at = wanted - 1; at >= 0; at -= 1) {
        const existing = survivor[at]
        if (existing === undefined || existing === null) {
            const row = makeRow(list, parent, anchor, keys[at], data[at], at)
            next[at] = row
            anchor = row.nodes[0] as ChildNode
            continue
        }
        // In the run that is already ordered: its nodes are where they belong relative to
        // everything after it, so touching them would be a move that changes nothing — and
        // `insertBefore` on a node already in position still counts as a move in every engine's
        // records, which is what makes "nodes moved" mean anything.
        if (keep !== null && keep[at] !== 1)
            for (const node of existing.nodes) parent.insertBefore(node, anchor)
        existing.at = at
        next[at] = existing
        anchor = existing.nodes[0] as ChildNode
    }

    // What the new order did not ask for.
    for (const row of held.values()) dropRow(row)
    list.rows = next
}

// A new row, built and inserted before `before`.
export function makeRow(
    list: List,
    parent: Node,
    before: Node,
    key: unknown,
    item: unknown,
    at: number,
): Row {
    const nodes = list.make(item, at)
    for (const node of nodes) parent.insertBefore(node, before)
    return rowOf(list, key, item, nodes, at)
}

// A row over nodes already in the document, mounted. The one place a row's record is written, so
// its shape is fixed once for every path that makes one — a made row and a hydrated one alike.
export function rowOf(
    list: List,
    key: unknown,
    item: unknown,
    nodes: Node[],
    at: number,
): Row {
    return { key, data: item, nodes, scope: list.mount(nodes, item, at), at }
}

// Stopped before removal, so a binding cannot wake over a node that is already gone.
export function dropRow(row: Row): void {
    row.scope.stop()
    for (const node of row.nodes) (node as ChildNode).remove()
}

// 41.15 — ONCE FOR THE BLOCK, not once a reconcile. A repeated key is a property of the `by`
// expression rather than of one write, so it holds for every reconcile the region ever runs and a
// warning per write is a console nobody reads.
//
// `abide:hydrate` RATHER THAN A CHANNEL OF ITS OWN. A repeated key is not a hydration mismatch —
// it survives a reconcile that no hydration was anywhere near — but the registry's meaning for
// that namespace is THE BROWSER LANE, not a mismatch, and it is the only namespace 28.8 gives the
// client runtime. A second one buys an app a second name to learn and silence for one warning,
// where widening the lane's one meaning costs nothing that has to be taught.
function warnRepeatedKey(list: List): void {
    if (list.warned) return
    list.warned = true
    console.warn(
        'abide:hydrate',
        'abide: a {#for} key is repeated in this list, so the last row under it is the one kept and the rows it shadows are dropped. RULEBOOK 41.14.',
    )
}

// THE LONGEST SUBSEQUENCE ALREADY IN INCREASING ORDER, as a flag per wanted index. Patience
// sorting: `tails[length - 1]` is the wanted-index of the smallest tail any increasing run of that
// length ends on, so the binary search finds the run each row extends, and `came` walks the answer
// back out.
//
// WHY A SUBSEQUENCE AND NOT A RUN OF NEIGHBOURS. The rows that can stay put are the ones already
// in the right order RELATIVE TO EACH OTHER — they need not be adjacent, and demanding they be
// would move rows that a gap of new or removed rows had merely spread apart.
//
// -1 IS A ROW THIS DOCUMENT DOES NOT HAVE, and it is skipped rather than ordered: a made row is
// inserted wherever the walk puts it, so it never counts as already in place and must never
// anchor a run that would hold a survivor still.
function longestRun(from: number[]): Uint8Array {
    const keep = new Uint8Array(from.length)
    // The wanted-index each run of a given length currently ends on.
    const tails: number[] = []
    // For each wanted index, the index its run continues from.
    const came = new Int32Array(from.length).fill(-1)
    for (let at = 0; at < from.length; at += 1) {
        const value = from[at] as number
        if (value < 0) continue
        let low = 0
        let high = tails.length
        while (low < high) {
            const middle = (low + high) >> 1
            if ((from[tails[middle] as number] as number) < value)
                low = middle + 1
            else high = middle
        }
        if (low > 0) came[at] = tails[low - 1] as number
        tails[low] = at
    }
    for (
        let at = tails.length === 0 ? -1 : (tails[tails.length - 1] as number);
        at >= 0;
    ) {
        keep[at] = 1
        at = came[at] as number
    }
    return keep
}
