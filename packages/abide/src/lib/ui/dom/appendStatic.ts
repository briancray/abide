import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'

/*
A static (non-reactive) text node under `parent`: created and appended (create
mode), or claimed from the server-rendered text (hydrate mode). As with reactive
text, a merged SSR text node is split at this literal's length so the next claim
lines up; nothing is bound since the text never changes.
*/
// @documentation plumbing
export function appendStatic(parent: Node, value: string, splitAlways = false): void {
    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        const node = claimChild(hydration, parent) as unknown as Text
        /* Split even on an exact-length consume when a sibling text binding follows
           (`splitAlways`), so it gets its own node; see appendText for the rationale. */
        if (
            node !== null &&
            (splitAlways ? value.length <= node.data.length : value.length < node.data.length)
        ) {
            node.splitText(value.length)
        }
        hydration.next.set(parent, node === null ? null : node.nextSibling)
        return
    }
    parent.appendChild(document.createTextNode(value))
}
