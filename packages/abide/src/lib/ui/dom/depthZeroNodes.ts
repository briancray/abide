import { commentData } from './commentData.ts'
import { markerDepthDelta } from './markerDepthDelta.ts'

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
            continue
        }
        const delta = markerDepthDelta(data)
        if (delta !== 0) {
            depth += delta
        } else if (depth === 0) {
            /* A non-marker comment (this skeleton's own `a` anchor) at depth 0. */
            own.push(node)
        }
    }
    return own
}
