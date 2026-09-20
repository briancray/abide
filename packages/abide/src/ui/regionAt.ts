import { Mismatch } from './Mismatch.ts'
import { parseMarkup } from './parseMarkup.ts'
import { REGION_CLOSE, REGION_OPEN } from './REGION.ts'

export type Region = { open: Comment; close: Comment }

// A REGION ROOT IS ONE OF THREE THINGS AND NONE OF THEM IS A SPECIAL CASE. The page's root is a
// NODE and `mount(root)` is handed one; a `{#if}` arm's children hang off its own anchors with no
// element over them, so the arm's root is its `Region`; and a `{#for}` row's children are the
// nodes the reconcile handed back, so the row's root is that ARRAY.
//
// All three ARE a run of siblings, which is the whole reason one walk serves them: only where the
// run STARTS and where it ENDS differ, and after the first step every root is a node. Resolving
// that first step at compile time instead asks for an inner region inside the arm's first CHILD,
// and a page carrying one hydrates nothing at all.
export type Root = Node | Region | Node[]

function isRegion(root: Node | Region): root is Region {
    return !('nodeType' in root)
}

// The nth node directly inside a region root, counted the way a document holds them: raw
// siblings. A region's own content is many nodes where the template counted one, which is why a
// child INDEX only ever addresses what stands before the first region in its parent — everything
// after one is counted from that region's closing anchor instead.
export function childOf(root: Root, at: number): Node | undefined {
    if (Array.isArray(root)) return root[at]
    if (!isRegion(root)) return root.childNodes[at]
    let node: Node | null = root.open
    for (let step = 0; step <= at; step += 1) {
        node = node.nextSibling
        if (node === null || node === root.close) return undefined
    }
    return node
}

// What a region root's nodes hang off, and what follows its last one — `null` for a node's own
// end. Where a node missing from the run is put back.
export function parentOf(root: Root): Node | null {
    if (Array.isArray(root)) return root[0]?.parentNode ?? null
    return isRegion(root) ? root.close.parentNode : root
}

export function endOf(root: Root): Node | null {
    if (Array.isArray(root)) return root[root.length - 1]?.nextSibling ?? null
    return isRegion(root) ? root.close : null
}

// The nth dynamic region directly inside a region root, found by counting its opening anchors.
// Only a root that HOLDS a region is ever scanned — everywhere else a child index is exact and
// costs no walk at all.
export function regionAt(root: Root, at: number): Region {
    // A row's nodes are consecutive siblings, so the run they form is the one between the first
    // and whatever follows the last.
    let node: Node | null = Array.isArray(root)
        ? (root[0] ?? null)
        : isRegion(root)
          ? root.open.nextSibling
          : root.firstChild
    const stop = endOf(root)

    let seen = -1
    let open: Comment | undefined
    let depth = 0
    for (; node !== null && node !== stop; node = node.nextSibling) {
        if (node.nodeType !== 8) continue
        const data = (node as Comment).data
        if (data === REGION_OPEN) {
            if (depth === 0) {
                seen += 1
                if (seen === at) open = node as Comment
            }
            depth += 1
            continue
        }
        if (data !== REGION_CLOSE) continue
        depth -= 1
        // A nested region's anchors are its own; only the one closing at depth zero is ours.
        if (depth === 0 && open !== undefined)
            return { open, close: node as Comment }
    }
    throw new Mismatch(
        `abide: region ${at} is not in the rendered document, so the client and the server disagree about this region's shape (41.11).`,
    )
}

// The nth node after a region's closing anchor. Siblings after a region cannot be addressed by
// child index — the region's own length moves them — so they are counted from the anchor that
// stays put whichever branch rendered. Absent rather than refused, because a blank text run
// renders nothing at all and its binding wants the POSITION rather than what is there.
export function nodeAfter(region: Region, at: number): Node | undefined {
    let node: Node | null = region.close
    for (let step = 0; step <= at; step += 1) {
        node = node.nextSibling
        if (node === null) return undefined
    }
    return node
}

// Everything between a region's anchors, replaced. The anchors themselves stay, which is what
// keeps every sibling after them addressable across a branch change.
// 32.19 — WHETHER A REGION IS WAITING TO BE FILLED. A component the SERVER rendered arrives with
// its markup between its anchors and is hydrated; one a row builder wrote in the browser arrives
// as the anchor pair alone, and the child fills it from its own template. The empty pair is the
// whole of the signal, so nothing is added to the document to carry it.
export function isEmptyRegion(root: Root): boolean {
    return (
        !Array.isArray(root) &&
        'open' in root &&
        root.open.nextSibling === root.close
    )
}

export function fillRegion(region: Region, markup: string): void {
    // THE PARENT IS READ BEFORE ANYTHING IS REMOVED, and the removal only happens if there is
    // one. Written as an unguarded removal followed by a `?.`-guarded insert, a region whose
    // close anchor had been detached emptied itself and then dropped the new content on the
    // floor — the one silent failure in a module where every other one refuses with 41.11 on it.
    const parent = region.close.parentNode
    if (parent === null)
        throw new Mismatch(
            `abide: this region is not in a document, so the client and the server disagree about this region's shape (41.11).`,
        )
    let node = region.open.nextSibling
    while (node !== null && node !== region.close) {
        const next = node.nextSibling
        node.remove()
        node = next
    }
    if (markup === '') return
    parent.insertBefore(parseMarkup(region.open, markup), region.close)
}
