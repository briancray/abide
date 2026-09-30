import { leave } from './leave.ts'
import { LAYER_FILL } from './LAYER_NAMES.ts'
import { Mismatch } from './Mismatch.ts'
import { beginLayer, endLayer } from './measureLayer.ts'
import { REGION_CAUGHT, REGION_CLOSE, REGION_OPEN, ROW_OPEN } from './REGION.ts'

export type Region = { open: Comment; close: Comment }

/**
 * The anchor that ends the run `open` starts, or null where it is not closed in this parent.
 *
 * WHAT ENDS THE RUN THAT `open` STARTS: the `REGION_CLOSE` at depth zero, or — where `atRow` — a
 * `ROW_OPEN` at depth zero too, which is where an anchored row ends. Walked by DEPTH because a
 * region nested inside carries its own pair, and a `{#for}` inside one its own row anchors, so
 * neither is mistaken for this run's end.
 */
export function closeOf(open: Node, atRow: boolean): Comment | null {
    let depth = 0
    for (let node = open.nextSibling; node !== null; node = node.nextSibling) {
        if (node.nodeType !== 8) continue
        const data = (node as Comment).data
        if (data === REGION_OPEN || data === REGION_CAUGHT) depth += 1
        else if (data === REGION_CLOSE) {
            if (depth === 0) return node as Comment
            depth -= 1
        } else if (atRow && depth === 0 && data === ROW_OPEN)
            return node as Comment
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
        const close = closeOf(node, false)
        if (close !== null) return { open: node as Comment, close }
    }
    throw new Mismatch(
        "abide: the host holds no page region, so the client and the server disagree about this document's shape (41.10).",
    )
}

/**
 * Whether a region is an empty anchor pair waiting to be filled.
 *
 * 32.18 — a component the SERVER rendered arrives with its markup between its anchors and is
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
 * untracked (`emitBlock`) and so do a list's rows (`updateList`).
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
    removeUntil(region.open.nextSibling, region.close)
    if (build === undefined) return
    beginLayer(LAYER_FILL)
    try {
        const made = build(region.close.ownerDocument as Document)
        for (const one of made) parent.insertBefore(one, region.close)
    } finally {
        endLayer(LAYER_FILL)
    }
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
