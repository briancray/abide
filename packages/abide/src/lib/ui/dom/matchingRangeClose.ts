import { commentData } from './commentData.ts'
import { markerDepthDelta } from './markerDepthDelta.ts'

/*
The `]` close marker that balances the `[` range opened by `open`, found by a DEPTH-counting
scan over the following siblings. A branch's content can hold nested `[`…`]` (if/switch/each)
and `abide:`…`/abide:` (await/try/snippet) ranges — `markerDepthDelta` scores each open `+1`
and each close `-1`, so an INNER close is skipped and only the one that returns to depth 0 is
this range's own. Unlike `discardBoundary`'s named-boundary scan (a unique id-suffixed close
string), the `[`/`]` alphabet is non-unique, so the depth count is what tells nested closes
apart. Throws on a desync (no balancing close) rather than over-scan to end-of-parent.
*/
export function matchingRangeClose(open: Node): Node {
    let depth = 1
    let node = open.nextSibling
    while (node !== null) {
        const data = commentData(node)
        if (data !== undefined) {
            depth += markerDepthDelta(data)
            if (depth === 0) {
                return node
            }
        }
        node = node.nextSibling
    }
    throw new Error(
        '[abide] hydration desync: a control-flow range open marker "[" has no balancing close "]" — the server DOM is truncated or a block diverged.',
    )
}
