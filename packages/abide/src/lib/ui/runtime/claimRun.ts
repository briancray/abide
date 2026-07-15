import { claimChild } from './claimChild.ts'
import { parkCursor } from './parkCursor.ts'
import type { HydrationCursor } from './types/HydrationCursor.ts'

/* Claims a run of `count` top-level server-rendered siblings at the parent's cursor and
   parks it past them (a short run — the server DOM ending early — parks on null). The
   static-clone paths advance through this: the markup is byte-identical to the server's,
   so nothing inside needs claiming individually. `into` collects the claimed nodes when
   the caller resolves holes against them (`skeleton`); omitted, the run is only skipped. */
export function claimRun(
    hydration: HydrationCursor,
    parent: Node,
    count: number,
    into?: Node[],
): void {
    let node = claimChild(hydration, parent)
    for (let index = 0; index < count && node !== null; index += 1) {
        into?.push(node)
        node = node.nextSibling
    }
    parkCursor(hydration, parent, node)
}
