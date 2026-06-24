import { clearBetween } from './clearBetween.ts'
import { fillBefore } from './fillBefore.ts'

/*
The one "replace a marker-bounded region's contents" operation. A control-flow block
that swaps a branch as a unit (if/else, switch, snippet) clears the live range
(disposing its scope and removing its nodes via `clearBetween`), then — if the new
branch has content — builds it fresh into the range before the close marker
(`fillBefore`). Returns the new content's disposer, or `undefined` for an empty
branch.

This is the single seam those blocks shared by copy-paste: same `clearBetween` +
conditional `fillBefore` shape, hand-rolled three times. Routing them through one
helper makes the region-update strategy a named, testable primitive.
*/
export function replaceRange(
    start: Node,
    end: Node,
    dispose: (() => void) | undefined,
    content: ((into: Node) => void) | undefined,
): (() => void) | undefined {
    clearBetween(start, end, dispose)
    return content !== undefined ? fillBefore(end, content) : undefined
}
