import { PATCHES } from '#shared/reactive/PATCHES.ts'
import { LAYER_RECONCILE } from './LAYER_NAMES.ts'
import type { List, RowBuilders } from './List.ts'
import { HYDRATE_LOG } from './Mismatch.ts'
import { beginLayer, endLayer } from './measureLayer.ts'
import { moveNode } from './moveNode.ts'
import { closeOf, type Region, removeUntil } from './regions.ts'
import { EMPTY_SCOPE, type Scope } from './Scope.ts'

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
    /**
     * The value the row was built from.
     *
     * A row that survives a reorder keeps its NODES, which is the whole point — but if the value
     * behind that key is a different object, its content is stale and the row is remade. Identity
     * is the signal here, the inverse of the case where a freshly built wrapper defeats one.
     */
    data: unknown
    /**
     * The row's first node: its element, or its `ROW_OPEN` anchor where the body has several.
     *
     * An anchored row is every sibling from here to the next row's anchor or the region's close
     * (`closeOf`) — a RANGE, as a region is its pair, and not the nodes `make` handed back: a
     * region at the row's top level fills AFTER the row is made, and a row held as that array moved
     * without the arm's content and left it standing after whichever row came next.
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
     * The patch epoch the row was made at (32.34).
     *
     * Its item written past this is content the row never saw, under the same object a kept row is
     * matched by.
     */
    seen: number
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

/**
 * Removes a row's nodes, from its first node to its end.
 *
 * AN ANCHOR IS A COMMENT AND A SINGLE ROOT IS AN ELEMENT, so the row's first node says which kind
 * of row it is and no flag is carried beside it.
 */
function removeRow(first: ChildNode): void {
    if (first.nodeType !== 8) {
        first.remove()
        return
    }
    removeUntil(first, closeOf(first, true))
}

/**
 * Moves a row's nodes, first to last, to before `before` through `moveNode`.
 *
 * TO THE LAST NODE RATHER THAN TO THE ROW'S END: a row moved before its own end puts each node it
 * moves between its tail and the end, so the sibling after the tail is the row's own anchor again
 * by the time the walk reaches it.
 */
function moveRow(parent: Node, first: ChildNode, before: Node | null): void {
    if (first.nodeType !== 8) {
        moveNode(parent, first, before)
        return
    }
    const end = closeOf(first, true)
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
            let node = closeOf(region.open, true);
            node !== null && node !== region.close;
            node = closeOf(node, true)
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
 * Reconciles a keyed list's rows to `data`, moving survivors rather than remaking them.
 *
 * `make` builds a row's nodes for a key it has not seen; `mount` wires one and hands back its
 * scope. Rows that survive are MOVED, never remade.
 */
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
    // OPENED AFTER THE ONLY EARLY EXIT, so the pair cannot go unbalanced. A region with no parent
    // reconciles nothing and is not a layer that ran.
    beginLayer(LAYER_RECONCILE)

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
    //
    // SIZED LIKE `next` ABOVE, for the same reason and none of its caveat: the loop below fills
    // both front-to-back for exactly `wanted` iterations, so neither can go sparse, and growing
    // them by `push` paid log2(n) reallocate-and-copy passes per reconcile on each.
    const from = new Array<number>(wanted)
    const survivor = new Array<Row | null>(wanted)
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
        if (
            existing !== undefined &&
            Object.is(existing.data, data[at]) &&
            !patchedSince(existing)
        ) {
            held.delete(key)
            existing.seen = PATCHES.epoch
            survivor[at] = existing
            from[at] = existing.at
            if (existing.at < lastSurvivor) ordered = false
            lastSurvivor = existing.at
            continue
        }
        // Either a key never seen, or one whose value is a different object or one a patch wrote
        // to — each is a row this document does not have, and each is made. A stale one's nodes go NOW: the placement
        // walk anchors on nodes that are still attached, and a node about to be replaced is not
        // one of them.
        if (existing !== undefined) {
            held.delete(key)
            dropRow(existing)
        }
        survivor[at] = null
        from[at] = -1
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
            anchor = row.node
            continue
        }
        // In the run that is already ordered: untouched, since a move there changes nothing and
        // still counts as one. 32.30 — a survivor is moved without leaving the document (`moveNode`).
        if (keep !== null && keep[at] !== 1)
            moveRow(parent, existing.node, anchor)
        existing.at = at
        next[at] = existing
        anchor = existing.node
    }

    // What the new order did not ask for.
    for (const row of held.values()) dropRow(row)
    list.rows = next
    endLayer(LAYER_RECONCILE)
}

/** A new row, built and inserted before `before`. */
export function makeRow(
    list: List,
    parent: Node,
    before: Node,
    key: unknown,
    item: unknown,
    at: number,
): Row {
    // 14.8 — set up ONCE for the row, and the same builders make it and mount it.
    const builders = list.setUp(item, at)
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
 * Whether a patch wrote to the row's item since the row was made.
 *
 * 32.34 — the epoch is compared first, so a reconcile with no patch since its rows were made pays
 * one integer compare a row and never reaches the map.
 */
function patchedSince(row: Row): boolean {
    if (row.seen === PATCHES.epoch) return false
    const item = row.data
    if (item === null || typeof item !== 'object') return false
    return (PATCHES.written.get(item) ?? 0) > row.seen
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

/**
 * Warns about a repeated `{#for}` key, once per block.
 *
 * 41.15 — ONCE FOR THE BLOCK, not once a reconcile. A repeated key is a property of the `by`
 * expression rather than of one write, so it holds for every reconcile the region ever runs and a
 * warning per write is a console nobody reads.
 *
 * `abide:hydrate` RATHER THAN A CHANNEL OF ITS OWN. A repeated key is not a hydration mismatch —
 * it survives a reconcile that no hydration was anywhere near — but the registry's meaning for
 * that namespace is THE BROWSER LANE, not a mismatch, and it is the only namespace 28.8 gives the
 * client runtime. A second one buys an app a second name to learn and silence for one warning,
 * where widening the lane's one meaning costs nothing that has to be taught.
 */
function warnRepeatedKey(list: List): void {
    if (list.warned) return
    list.warned = true
    HYDRATE_LOG.warning(
        'abide: a {#for} key is repeated in this list, so the last row under it is the one kept and the rows it shadows are dropped. RULEBOOK 41.14.',
    )
}

/**
 * Flags, per wanted index, the rows in the longest subsequence already in order.
 *
 * Patience sorting: `tails[length - 1]` is the wanted-index of the smallest tail any increasing run
 * of that length ends on, so the binary search finds the run each row extends, and `came` walks the
 * answer back out.
 *
 * WHY A SUBSEQUENCE AND NOT A RUN OF NEIGHBOURS. The rows that can stay put are the ones already
 * in the right order RELATIVE TO EACH OTHER — they need not be adjacent, and demanding they be
 * would move rows that a gap of new or removed rows had merely spread apart.
 *
 * -1 IS A ROW THIS DOCUMENT DOES NOT HAVE, and it is skipped rather than ordered: a made row is
 * inserted wherever the walk puts it, so it never counts as already in place and must never
 * anchor a run that would hold a survivor still.
 */
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
