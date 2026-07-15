import { advanceClaim } from '../runtime/advanceClaim.ts'
import { claimExpected } from '../runtime/claimExpected.ts'
import { OUTLET_CLOSE, OUTLET_OPEN } from '../runtime/OUTLET_MARKER.ts'
import { PENDING_OUTLET } from '../runtime/PENDING_OUTLET.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { commentData } from './commentData.ts'

/*
A layout's `<slot/>` outlet: an empty `<!--abide:outlet-->`…`<!--/abide:outlet-->`
boundary the router fills with the next chain layer (`fillBoundary`). No wrapper
element, so the filled child lays out as a direct child of the slot's parent.

Create: insert the empty boundary at `before` (the anchor's cursor). Hydrate: claim the
open marker, then SKIP the server-rendered child content — the router re-claims it when
it fills the boundary — by advancing the parent's claim cursor past the MATCHING close
(depth-counting nested outlets), so the layout's own claims after the slot stay aligned.
Records the boundary in `PENDING_OUTLET` (and returns it) so the router learns where the
next chain layer mounts without scanning the DOM.
*/
// @documentation plumbing
export function outlet(
    parent: Node,
    before: Node | null = null,
): { open: Comment; close: Comment } {
    const hydration = RENDER.hydration
    if (hydration === undefined) {
        const open = document.createComment(OUTLET_OPEN)
        const close = document.createComment(OUTLET_CLOSE)
        parent.insertBefore(open, before)
        parent.insertBefore(close, before)
        PENDING_OUTLET.current = { open, close }
        return { open, close }
    }
    const open = claimExpected(hydration, parent, 'outlet open marker') as Comment
    /* Skip to the matching close: depth-count outlet markers (nested child-layer slots
       are balanced), so a layout wrapping another layout skips its WHOLE subtree. */
    let depth = 1
    let node: Node | null = open.nextSibling
    while (node !== null) {
        const data = commentData(node)
        if (data === OUTLET_OPEN) {
            depth += 1
        } else if (data === OUTLET_CLOSE) {
            depth -= 1
            if (depth === 0) {
                break
            }
        }
        node = node.nextSibling
    }
    /* No matching close — the server stream ended inside the slot (a mid-render error
       or truncation). Throw AT the divergence like `claimExpected`, rather than store a
       null close that a later `clearBetween(open, null)` would over-clear to end-of-parent. */
    if (node === null) {
        throw new Error(
            '[abide] hydration desync: outlet open marker has no matching close — the server DOM is truncated inside a layout slot.',
        )
    }
    const close = node as Comment
    advanceClaim(hydration, parent, close)
    PENDING_OUTLET.current = { open, close }
    return { open, close }
}
