import { RANGE_CLOSE, RANGE_OPEN } from '../runtime/RANGE_MARKER.ts'

/* The block-range nesting rule, the single source both marker-depth scans share
   (`depthZeroNodes`'s anchor filter and `skeleton`'s `elementChildAt` element walk):
   `+1` opening a range, `-1` closing one, `0` for any other comment. A control-flow
   block's rendered content sits between an OPEN and CLOSE comment — `[`…`]` for each
   rows / if / switch / slot ranges, named `abide:…`…`/abide:…` for await / try /
   snippet / html / component-mount (`abide:c:`, ADR-0049); the skeleton's own anchor
   (`a`) sits OUTSIDE any range, so it scores `0`. Keeping the rule here means a new
   marker family updates one place, so the two scans can never disagree on what nests. */
export function markerDepthDelta(data: string): number {
    if (data === RANGE_CLOSE || data.startsWith('/abide:')) {
        return -1
    }
    if (data === RANGE_OPEN || data.startsWith('abide:')) {
        return 1
    }
    return 0
}
