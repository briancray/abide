import { detachLink } from './detachLink.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Detaches a node from every source it reads — the dispose path for a computed or
effect torn down with its scope. Walks the node's dependency list once, removing
each edge from its source's subscriber list so no source keeps a back-link to a
dead observer, then empties the node's own list. The `Set`-era equivalent was
`for (dep of node.deps) dep.observers.delete(node); node.deps.clear()`.
*/
export function unlinkDeps(node: ReactiveNode): void {
    let link = node.depsHead
    while (link !== undefined) {
        const next = link.nextDep
        detachLink(link)
        link = next
    }
    node.depsHead = undefined
    node.depsTail = undefined
}
