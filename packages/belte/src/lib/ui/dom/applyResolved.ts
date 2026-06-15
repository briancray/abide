import { RESUME } from '../runtime/RESUME.ts'

/*
Client consumer of an SSR stream fragment. Parses a streamed
`<belte-resolve data-id="ID" data-resume="…">…</belte-resolve>` frame, registers
its serialized value in the resume manifest (for later hydration), finds the
matching `<!--belte:await:ID-->…<!--/belte:await:ID-->` boundary in `root`, removes
the pending nodes between the markers, and inserts the resolved content in their
place. The pending shell painted instantly; this swaps in each value as it
arrives — completing the out-of-order streaming loop on the client.
*/
// @readme plumbing
export function applyResolved(root: Element, frame: string): void {
    const holder = document.createElement('div')
    holder.innerHTML = frame
    const resolved = holder.firstChild as Element | null
    if (resolved === null || resolved.getAttribute === undefined) {
        return
    }
    const id = resolved.getAttribute('data-id')
    if (id === null) {
        return
    }
    /* Record the resolved value so a later hydrate adopts this branch (no re-fetch). */
    const resume = resolved.getAttribute('data-resume')
    if (resume !== null) {
        try {
            RESUME[Number(id)] = JSON.parse(resume)
        } catch {
            /* malformed payload — leave unregistered, hydration re-runs the promise */
        }
    }
    const open = `belte:await:${id}`
    const close = `/belte:await:${id}`
    const boundary = findBoundary(root, open)
    if (boundary === undefined) {
        return
    }
    const { parent, start } = boundary
    /* Remove the pending nodes between the markers (exclusive of the markers). */
    let node = start.nextSibling
    while (node !== null && !isComment(node, close)) {
        const next = node.nextSibling
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

/* A comment node carrying exactly `data`. */
function isComment(node: Node, data: string): boolean {
    return (node as { data?: string }).data === data && node.childNodes.length === 0
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
