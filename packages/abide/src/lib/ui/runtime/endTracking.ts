import { detachLink } from './detachLink.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Closes a dependency-capture pass: every edge trailing the recompute cursor
(`depsTail`) is a dependency last run read but this run didn't, so unlink it from
its source and truncate the list at the cursor. `track` advanced the cursor past
each reused edge during compute, so the cursor is the new tail. A node that read
nothing leaves the cursor at the start (`undefined`), dropping every edge.
*/
export function endTracking(node: ReactiveNode): void {
    const cursor = node.depsTail
    let stale = cursor === undefined ? node.depsHead : cursor.nextDep
    while (stale !== undefined) {
        const next = stale.nextDep
        detachLink(stale)
        stale = next
    }
    if (cursor !== undefined) {
        cursor.nextDep = undefined
    } else {
        node.depsHead = undefined
    }
}
