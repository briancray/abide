import { seedResolved } from '../seedResolved.ts'
import { isComment } from './isComment.ts'

/*
Bundle-side consumer of an SSR stream chunk, the counterpart of the doc stream's inline
vanilla scripts (`SSR_SWAP_SCRIPT`'s `__abideSwap` and `CACHE_RESOLVE_SCRIPT`'s `__abideResolve`) for a stream the
running bundle consumes itself — streaming SPA navigation, socket-delivered SSR. It routes
the two chunk kinds the stream interleaves:

  - `<abide-cache>{StreamedResolution}</abide-cache>` → seed the streamed cache partition.
    A script set via innerHTML never runs, so the cache channel rides a data frame here
    (not the doc stream's `<script>__abideResolve(…)</script>`); seeding it keeps the
    pending {#await} read warm instead of cold-missing to the network.
  - `<abide-resolve data-id="ID"><script type="application/json">…</script>…</abide-resolve>`
    → register the value in the resume manifest (for hydration), find the matching
    `<!--abide:await:ID-->…<!--/abide:await:ID-->` boundary in `root`, remove the pending
    nodes between the markers, and insert the resolved content in their place.

The pending shell painted instantly; this swaps in each value as it arrives — completing
the out-of-order streaming loop on the client.
*/
// @documentation plumbing
export function applyResolved(root: Element, frame: string): void {
    const holder = document.createElement('div')
    holder.innerHTML = frame
    const resolved = holder.firstChild as Element | null
    if (resolved === null || resolved.getAttribute === undefined) {
        return
    }
    /* A cache-seed frame warms the streamed cache partition — paired with the DOM swap so a
       bundle-consumed stream can't adopt a resolved branch while dropping its cache key. */
    if (resolved.nodeName === 'ABIDE-CACHE') {
        try {
            seedResolved({ kind: 'cache', resolution: JSON.parse(resolved.textContent ?? 'null') })
        } catch {
            /* malformed payload — leave unseeded; the read falls back to a live fetch */
        }
        return
    }
    const id = resolved.getAttribute('data-id')
    if (id === null) {
        return
    }
    /* The resolved value rides in a leading <script type=application/json> as ref-json
       text; store it raw and remove the node so only the resolved markup moves into the
       boundary. Decoding is deferred to the read in `awaitBlock` (which has the codec);
       recording it lets a later hydrate adopt this branch (no re-fetch). */
    const payload = resolved.firstChild as Element | null
    if (payload !== null && payload.nodeName === 'SCRIPT') {
        seedResolved({ kind: 'resume', id: Number(id), resume: payload.textContent ?? '' })
        payload.remove()
    }
    const open = `abide:await:${id}`
    const close = `/abide:await:${id}`
    const boundary = findBoundary(root, open)
    if (boundary === undefined) {
        return
    }
    const { parent, start } = boundary
    /* Locate the close marker WITHOUT mutating first — mirroring discardBoundary. Removing
       nodes as we walk would, on a marker/id desync, delete every remaining sibling before
       discovering there is no match — silently wiping unrelated later content. Throw at the
       divergence instead of over-clearing to end-of-parent. */
    let closeNode: Node | null = start.nextSibling
    while (closeNode !== null && !isComment(closeNode, close)) {
        closeNode = closeNode.nextSibling
    }
    if (closeNode === null) {
        throw new Error(
            `[abide] stream swap desync: await boundary open marker "${open}" has no matching close "${close}" — the streamed frame or block id drifted.`,
        )
    }
    /* Remove the pending nodes between the markers (exclusive), now that the range is bounded. */
    let node: Node | null = start.nextSibling
    while (node !== null && node !== closeNode) {
        const next: Node | null = node.nextSibling
        parent.removeChild(node)
        node = next
    }
    /* Insert resolved content after the open marker. */
    let anchor = start.nextSibling
    for (const child of [...resolved.childNodes]) {
        parent.insertBefore(child, anchor)
        anchor = child.nextSibling
    }
}

/* Depth-first search for the parent + open-marker comment of a boundary. */
function findBoundary(node: Node, open: string): { parent: Node; start: Node } | undefined {
    for (const child of [...node.childNodes]) {
        if (isComment(child, open)) {
            return { parent: node, start: child }
        }
        const nested = findBoundary(child, open)
        if (nested !== undefined) {
            return nested
        }
    }
    return undefined
}
