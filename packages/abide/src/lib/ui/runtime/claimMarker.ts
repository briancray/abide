import { claimExpected } from './claimExpected.ts'
import { parkCursor } from './parkCursor.ts'
import type { HydrationCursor } from './types/HydrationCursor.ts'

/* Claims a compiler-guaranteed marker node (a range bracket, a block/boundary comment,
   a keyed-row bracket) at the parent's cursor and advances past it. Throws a legible
   structural desync when no node is there (`claimExpected`) — a missing marker means
   SSR markup and the client build disagree on structure at this position. */
export function claimMarker(hydration: HydrationCursor, parent: Node, expected: string): Comment {
    const node = claimExpected(hydration, parent, expected)
    parkCursor(hydration, parent, node.nextSibling)
    return node as Comment
}
