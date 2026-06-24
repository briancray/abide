import { RANGE_CLOSE, RANGE_OPEN } from '../runtime/RANGE_MARKER.ts'
import { commentData } from './commentData.ts'

/* Block-range boundary markers. A control-flow block's rendered content (and a child
   component's, which mounts as a range too) sits between an OPEN and CLOSE comment: `[`…`]`
   for each/if/switch/slot ranges, `abide:…`…`/abide:…` for await/try/snippet/html. THIS
   skeleton's own anchor (`a`) sits OUTSIDE any such range. */
function isOpenMarker(data: string): boolean {
    return data === RANGE_OPEN || data.startsWith('abide:')
}
function isCloseMarker(data: string): boolean {
    return data === RANGE_CLOSE || data.startsWith('/abide:')
}

/*
A sibling list's DEPTH-0 nodes — those belonging to THIS skeleton's own structure, excluding
any node inside a block/component's `[`…`]` / `abide:` range (depth > 0), whose anchors belong
to that range's OWN skeleton. The realized-DOM analogue of the compiler's fresh-context
boundary: the shared anchor walk (`walkAnchorOrder`) classifies one node at a time and so can't
skip a sibling RUN, so the marker-depth skip lives here, feeding the walk only own-skeleton
nodes. In create mode the clone is shallow (no markers built yet), so depth stays 0 and every
node is returned — a plain document scan.
*/
export function depthZeroNodes(nodes: ArrayLike<Node>): Node[] {
    const own: Node[] = []
    let depth = 0
    for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index] as Node
        const data = commentData(node)
        if (data === undefined) {
            if (depth === 0) {
                own.push(node)
            }
        } else if (isCloseMarker(data)) {
            depth -= 1
        } else if (isOpenMarker(data)) {
            depth += 1
        } else if (depth === 0) {
            /* A non-marker comment (this skeleton's own `a` anchor) at depth 0. */
            own.push(node)
        }
    }
    return own
}
