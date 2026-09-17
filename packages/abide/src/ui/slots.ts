import { SLOT_OPEN } from './MARKERS.ts'

// The text node of every slot the server marked, in document order — the same order the compiler
// numbered them in. Walked ONCE per mount, not per row, so a TreeWalker is the cheap way to do it
// rather than something to avoid.
//
// A slot whose value rendered EMPTY has no text node between its markers, so one is inserted. That
// is the case a walk written against the happy shape gets wrong: the next node is the closing
// marker, and binding to it writes a comment's data instead of the document's text.
export function slots(root: Node): Text[] {
    const document = root.ownerDocument ?? (root as Document)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT)
    const found: Text[] = []
    const open: Comment[] = []
    while (true) {
        const comment = walker.nextNode() as Comment | null
        if (comment === null) break
        if (comment.data === SLOT_OPEN) open.push(comment)
    }
    for (const marker of open) {
        const next = marker.nextSibling
        if (next !== null && next.nodeType === 3) {
            found.push(next as Text)
            continue
        }
        const text = document.createTextNode('')
        marker.after(text)
        found.push(text)
    }
    return found
}
