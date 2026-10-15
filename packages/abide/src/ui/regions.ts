import { REGION_CLOSE, REGION_OPEN } from '#shared/ANCHORS.ts'
import { LAYER_FILL } from './LAYER_NAMES.ts'
import { anyLeaving, leave } from './leave.ts'
import { Mismatch } from './Mismatch.ts'
import { beginLayer, endLayer } from './measureLayer.ts'

export type Region = { open: Comment; close: Comment }

/**
 * Whether a comment's data opens a region: `REGION_OPEN`, or an open naming the arm the server
 * painted (41.24, `armAnchor`).
 *
 * BY THE FIRST CHARACTER, so a walk counting depth reads every spelling of an open as one. No other
 * comment a document carries starts with it: an author's comment is dropped at compile, and a
 * run's and a row's anchors are spelled apart (`RAW_OPEN`, `ROW_OPEN`).
 */
export function opensRegion(data: string): boolean {
    return data[0] === REGION_OPEN
}

/**
 * The `REGION_CLOSE` that ends the region `open` starts, or null where it is not closed in this
 * parent.
 *
 * Walked by DEPTH because a region nested inside carries its own pair.
 */
export function closeOf(open: Node): Comment | null {
    let depth = 0
    for (let node = open.nextSibling; node !== null; node = node.nextSibling) {
        if (node.nodeType !== 8) continue
        const data = (node as Comment).data
        if (opensRegion(data)) depth += 1
        else if (data === REGION_CLOSE) {
            if (depth === 0) return node as Comment
            depth -= 1
        }
    }
    return null
}

/**
 * The page's region, as the server wrote it; throws `Mismatch` where the host holds none.
 *
 * The first `REGION_OPEN` among the host's children and the close that ends it. The server writes
 * the page between the same pair `renderComponent` writes a child between (41.9), so everything a
 * shell puts in the host — its module script, a stylesheet link — stands outside the pair wherever
 * the shell put it, and nothing here has to guess where the page ends.
 */
export function pageRegion(host: Node): Region {
    for (let node = host.firstChild; node !== null; node = node.nextSibling) {
        if (node.nodeType !== 8 || (node as Comment).data !== REGION_OPEN)
            continue
        const close = closeOf(node)
        if (close !== null) return { open: node as Comment, close }
    }
    throw new Mismatch(
        "abide: the host holds no page region, so the client and the server disagree about this document's shape (41.10).",
    )
}

/**
 * Whether a region is an empty anchor pair waiting to be filled.
 *
 * 32.17 — a component the SERVER rendered arrives with its markup between its anchors and is
 * hydrated; one a row builder wrote in the browser arrives as the anchor pair alone, and the child
 * fills it from its own template. The empty pair is the whole of the signal, so nothing is added to
 * the document to carry it.
 */
export function isEmptyRegion(region: Region): boolean {
    return region.open.nextSibling === region.close
}

/**
 * Replaces everything between a region's anchors with what `build` makes, or with nothing.
 *
 * The anchors themselves stay, which is what keeps every sibling after them addressable across a
 * branch change.
 *
 * THE BUILD IS CALLED HERE, handed the region's own document, rather than its nodes being handed
 * in. A region's document is its anchor's, and a mount's root is a `Region`, not a node, so the
 * root has no document to ask for. And the `abide.fill` layer then times the build as well as the
 * insert, which is the whole of what filling a region costs.
 *
 * 14.1 — A BUILD EVALUATES EVERY VALUE IT WRITES, so it must not run tracked: an arm's swap runs
 * untracked (`ArmRegion`) and so do a list's rows (`updateList`).
 */
export function fillRegion(
    region: Region,
    build?: (document: Document) => Node[],
): void {
    // THE PARENT IS READ BEFORE ANYTHING IS REMOVED, and the removal only happens if there is
    // one. Written as an unguarded removal followed by a `?.`-guarded insert, a region whose
    // close anchor had been detached emptied itself and then dropped the new content on the
    // floor — the one silent failure in a module where every other one refuses with 41.10 on it.
    const parent = region.close.parentNode
    if (parent === null)
        throw new Mismatch(
            `abide: this region is not in a document, so the client and the server disagree about this region's shape (41.10).`,
        )
    emptyRegion(region, parent)
    if (build === undefined) return
    beginLayer(LAYER_FILL)
    try {
        const made = build(region.close.ownerDocument as Document)
        for (const one of made) parent.insertBefore(one, region.close)
    } finally {
        endLayer(LAYER_FILL)
    }
}

/**
 * Fills a region nobody painted; answers whether it did.
 *
 * 32.17, 41.4, 30.7 — THE FIRST ENTRY OF A REGION THAT FILLS ITSELF: a component the server
 * rendered, a page it served, a slot it wrote, arrives with its markup and is hydrated; one the
 * browser grew, navigated to, or the server left behind a subject in flight arrives as the pair
 * alone and is built here. What every emitted component asks once, as one call rather than the
 * `isEmptyRegion` guard written out at each.
 */
export function fillEmpty(
    region: Region,
    build?: (document: Document) => Node[],
): boolean {
    if (!isEmptyRegion(region)) return false
    fillRegion(region, build)
    return true
}

/**
 * Removes everything between a region's anchors, which stay.
 *
 * ONE WRITE WHERE THE REGION IS ALL ITS PARENT HOLDS — a `<tbody>` or a `<ul>` around one
 * `{#for}`, the common shape of a list emptied — and the anchors put back after it. A removal per
 * node is a crossing into the engine per node; the engine's own clear is one.
 *
 * NODE BY NODE WHILE ANYTHING IS LEAVING (32.38), because a node holding a leaving element has to
 * stay where it stands, and only `leave` asks.
 */
export function emptyRegion(region: Region, parent: ParentNode): void {
    const { open, close } = region
    if (
        anyLeaving() ||
        parent.firstChild !== open ||
        parent.lastChild !== close
    ) {
        removeUntil(open.nextSibling, close)
        return
    }
    if (open.nextSibling === close) return
    parent.textContent = ''
    parent.append(open, close)
}

/** Removes `from` and every sibling after it, up to and not including `end`. */
export function removeUntil(from: ChildNode | null, end: Node | null): void {
    let node = from
    while (node !== null && node !== end) {
        const next: ChildNode | null = node.nextSibling
        leave(node)
        node = next
    }
}
