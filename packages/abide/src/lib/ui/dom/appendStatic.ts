import { claimChild } from '../runtime/claimChild.ts'
import { parkCursor } from '../runtime/parkCursor.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { claimText } from './claimText.ts'

/*
A static (non-reactive) text node under `parent`: created and appended (create
mode), or claimed from the server-rendered text (hydrate mode) — the shared
`claimText` asserts, splits the merged SSR node at this literal's length so the
next claim lines up, and advances. Nothing is bound since the text never changes.
A static always renders on the server, so a non-text node at the cursor is a
tolerated desync: advance past it (assertClaimedText's domain is a text mismatch;
a structural one is claimExpected's).
*/
// @documentation plumbing
export function appendStatic(parent: Node, value: string, splitAlways = false): void {
    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        if (claimText(hydration, parent, value, splitAlways) === undefined) {
            const node = claimChild(hydration, parent)
            parkCursor(hydration, parent, node === null ? null : node.nextSibling)
        }
        return
    }
    parent.appendChild(document.createTextNode(value))
}
