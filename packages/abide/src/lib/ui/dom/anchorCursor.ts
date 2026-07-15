import { parkCursor } from '../runtime/parkCursor.ts'
import { RENDER } from '../runtime/RENDER.ts'

/*
Positions a skeleton-anchored control-flow block or slot. The anchor (`<!--a-->`) sits
just before the block's range in BOTH the cloned skeleton and the server DOM, so it marks
the block's position independently of how wide the surrounding values or earlier blocks
render — the wall element-count positioning hits once block content varies in element
count.

Returns the CREATE insertion reference (the node right after the anchor), so the block's
range lands at the anchor's position rather than the parent's end. On hydrate it also parks
the parent's claim cursor there, so the block claims its own server range in place (the
block ignores the returned reference on hydrate). `parentNode` is the located element the
anchor was cloned into.
*/
// @documentation plumbing
export function anchorCursor(anchor: Node): Node | null {
    const reference = anchor.nextSibling
    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        parkCursor(hydration, anchor.parentNode as Node, reference)
    }
    return reference
}
