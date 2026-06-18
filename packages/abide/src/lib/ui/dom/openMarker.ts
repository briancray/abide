import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'

/*
Opens a control-flow range boundary: a comment marker. Create mode appends a fresh
comment to `parent`; hydrate mode claims the server-rendered marker at the parent's
cursor and advances it. Markers are real comment nodes so they survive in the SSR
HTML and the block can claim them positionally on hydrate — the boundary that lets
a branch hold ANY content (components, text, nested blocks, snippets) as a range,
rather than a list of single nodes.
*/
export function openMarker(parent: Node, data: string): Comment {
    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        const node = claimChild(hydration, parent) as unknown as Comment
        hydration.next.set(parent, node === null ? null : node.nextSibling)
        return node
    }
    const node = document.createComment(data)
    parent.appendChild(node)
    return node
}
