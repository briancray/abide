import { claimExpected } from '../runtime/claimExpected.ts'
import { RENDER } from '../runtime/RENDER.ts'

/*
Opens a control-flow range boundary: a comment marker. Create mode appends a fresh
comment to `parent`; hydrate mode claims the server-rendered marker at the parent's
cursor and advances it. Markers are real comment nodes so they survive in the SSR
HTML and the block can claim them positionally on hydrate — the boundary that lets
a branch hold ANY content (components, text, nested blocks, snippets) as a range,
rather than a list of single nodes.
*/
export function openMarker(parent: Node, data: string, before: Node | null = null): Comment {
    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        const node = claimExpected(hydration, parent, `control-flow marker "${data}"`) as Comment
        hydration.next.set(parent, node.nextSibling)
        return node
    }
    const node = document.createComment(data)
    /* `before` (a node already in `parent`) places the block among static siblings —
       its content lands at that position; without it the marker appends (block at tail). */
    parent.insertBefore(node, before)
    return node
}
