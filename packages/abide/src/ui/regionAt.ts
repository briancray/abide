import { REGION_CLOSE, REGION_OPEN } from './REGION.ts'

export type Region = { open: Comment; close: Comment }

// The nth dynamic region directly inside `parent`, found by counting its opening anchors. Only a
// parent that HOLDS a region is ever scanned — everywhere else a child index is exact and costs
// no walk at all.
export function regionAt(parent: Node, at: number): Region {
    let seen = -1
    let open: Comment | undefined
    let depth = 0
    for (let node = parent.firstChild; node !== null; node = node.nextSibling) {
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
    throw new Error(
        `abide: region ${at} is not in the rendered document, so the client and the server disagree about this region's shape (41.11).`,
    )
}

// The nth node after a region's closing anchor. Siblings after a region cannot be addressed by
// child index — the region's own length moves them — so they are counted from the anchor that
// stays put whichever branch rendered.
export function afterRegion(region: Region, at: number): Node {
    let node: Node | null = region.close
    for (let step = 0; step <= at; step += 1) {
        node = node === null ? null : node.nextSibling
        if (node === null)
            throw new Error(
                `abide: nothing ${at} nodes after this region, so the client and the server disagree about its shape (41.11).`,
            )
    }
    return node
}

// The nth node INSIDE a region — the arm's own children, counted from the opening anchor. An
// arm's paths are its own: `[0,1]` in one arm and `[0,1]` in another are two different nodes, and
// neither arm can reach the other's.
export function insideRegion(region: Region, at: number): Node {
    let node: Node | null = region.open
    for (let step = 0; step <= at; step += 1) {
        node = node === null ? null : node.nextSibling
        if (node === null || node === region.close)
            throw new Error(
                `abide: this region has no node ${at}, so the client and the server disagree about its shape (41.11).`,
            )
    }
    return node
}

// Everything between a region's anchors, replaced. The anchors themselves stay, which is what
// keeps every sibling after them addressable across a branch change.
export function fillRegion(region: Region, markup: string): void {
    let node = region.open.nextSibling
    while (node !== null && node !== region.close) {
        const next = node.nextSibling
        node.parentNode?.removeChild(node)
        node = next
    }
    if (markup === '') return
    const document = region.open.ownerDocument as Document
    const template = document.createElement('template')
    template.innerHTML = markup
    region.close.parentNode?.insertBefore(template.content, region.close)
}
