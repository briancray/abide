import { advanceClaim } from '../runtime/advanceClaim.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { assertClaimedText } from './assertClaimedText.ts'

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
        const isText = node !== null && typeof node.splitText === 'function'
        /* The claimed SSR node must begin with this literal, or the split misaligns — throw
           legibly at the divergence (only when a text node is actually here; a structural
           mismatch is claimExpected's domain). */
        if (isText) {
            assertClaimedText(node, value)
        }
        /* Split even on an exact-length consume when a sibling text binding follows
           (`splitAlways`), so it gets its own node; see appendText for the rationale. */
        if (
            isText &&
            (splitAlways ? value.length <= node.data.length : value.length < node.data.length)
        ) {
            node.splitText(value.length)
        }
        advanceClaim(hydration, parent, node)
        return
    }
    parent.appendChild(document.createTextNode(value))
}
