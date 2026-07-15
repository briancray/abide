import { claimChild } from '../runtime/claimChild.ts'
import { parkCursor } from '../runtime/parkCursor.ts'
import type { HydrationCursor } from '../runtime/types/HydrationCursor.ts'
import { assertClaimedText } from './assertClaimedText.ts'

/*
Claims one text consumer's portion of the merged SSR text node at the parent's cursor:
assert the node begins with `value` (or the split below misaligns and orphans the tail),
split the node at the value's length so the remainder stays claimable, and advance past
the claimed portion. `splitAlways` splits even on an exact-length consume — a non-final
consumer in a run must leave a node behind for its sibling (an interpolation rendering
empty otherwise has no node and the next claim grabs the wrong sibling); the final
consumer keeps the cheaper split-only-when-shorter path.

Returns undefined WITHOUT moving the cursor when the cursor doesn't hold a text node —
a value that rendered empty on the server emitted no text node, so the cursor sits on
the following element/comment or past the end. The caller owns that miss policy (bind a
synthesized node, or skip); a text node is detected by `splitText`, not `nodeType`, so
the test mini-dom is covered too.
*/
export function claimText(
    hydration: HydrationCursor,
    parent: Node,
    value: string,
    splitAlways: boolean,
): Text | undefined {
    const claimed = claimChild(hydration, parent)
    if (claimed === null || typeof (claimed as Text).splitText !== 'function') {
        return undefined
    }
    const node = claimed as Text
    assertClaimedText(node, value)
    if (splitAlways ? value.length <= node.data.length : value.length < node.data.length) {
        node.splitText(value.length)
    }
    parkCursor(hydration, parent, node.nextSibling)
    return node
}
