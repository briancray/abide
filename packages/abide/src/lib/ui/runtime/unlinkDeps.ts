import { abortNode } from './abortNode.ts'
import { detachLink } from './detachLink.ts'
import { reactiveAbortState } from './reactiveAbortState.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Detaches a node from every source it reads — the dispose path for a computed or
effect torn down with its scope. Walks the node's dependency list once, removing
each edge from its source's subscriber list so no source keeps a back-link to a
dead observer, then empties the node's own list. The `Set`-era equivalent was
`for (dep of node.deps) dep.observers.delete(node); node.deps.clear()`.
*/
export function unlinkDeps(node: ReactiveNode): void {
    /* Disposing tears this computation out of the graph — abort any RPC it left in
       flight, its result would land in a scope that no longer exists. Gated inline so
       the common disarmed dispose pays one property read, not a call. */
    if (reactiveAbortState.armed) {
        abortNode(node)
    }
    let link = node.depsHead
    while (link !== undefined) {
        const next = link.nextDep
        detachLink(link)
        link = next
    }
    node.depsHead = undefined
    node.depsTail = undefined
}
