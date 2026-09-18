import { SLOT_OPEN } from './MARKERS.ts'

// The text node of every slot in THIS REGION, indexed by the number the compiler gave it — not by
// the order the markers are met, which is a different thing the moment a region can be absent or
// repeated. See `MARKERS.ts`.
//
// Walked ONCE per region mount, not per row, so a TreeWalker is the cheap way to do it rather
// than something to avoid.
export function slots(root: Node): Text[] {
    const document = root.ownerDocument ?? (root as Document)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT)
    const found: Text[] = []
    while (true) {
        const comment = walker.nextNode() as Comment | null
        if (comment === null) break
        const data = comment.data
        if (!data.startsWith(SLOT_OPEN) || data.length === SLOT_OPEN.length)
            continue
        const at = Number(data.slice(SLOT_OPEN.length))
        if (!Number.isInteger(at)) continue

        // A slot whose value rendered EMPTY has no text node between its markers, so one is
        // inserted. That is the case a walk written against the happy shape gets wrong: the next
        // node is the closing marker, and binding to it writes a comment's data as if it were
        // the document's text.
        const next = comment.nextSibling
        if (next !== null && next.nodeType === 3) {
            found[at] = next as Text
            continue
        }
        const text = document.createTextNode('')
        comment.after(text)
        found[at] = text
    }
    return found
}
