import type { AnchorRole, AnchorWalkAdapter } from '../compile/walkAnchorOrder.ts'
import { ANCHOR } from '../runtime/RANGE_MARKER.ts'
import { commentData } from './commentData.ts'
import { depthZeroNodes } from './depthZeroNodes.ts'
import { isElement } from './isElement.ts'

/*
The realized-DOM side of the shared anchor-ordering rule (`walkAnchorOrder`). Classifies each
recovered node by the SAME positions the template-AST side numbered (`templateAnchorAdapter`),
so `scanAnchors`'s collection lines up with the compiler's `anIndex`.

An `a` comment is this skeleton's own anchor (one position); an element is an own-skeleton
container to descend; anything else contributes nothing. `childrenOf` returns only depth-0
nodes — a nested block/component's marker-bracketed content is skipped exactly as the compiler
stops at a fresh-context boundary.
*/
export const domAnchorAdapter: AnchorWalkAdapter<Node> = {
    classify: (node: Node): AnchorRole => {
        const data = commentData(node)
        if (data === ANCHOR) {
            return { kind: 'anchor', positions: [node] }
        }
        if (data === undefined && isElement(node)) {
            return { kind: 'recurse' }
        }
        return { kind: 'skip' }
    },
    childrenOf: (node: Node): readonly Node[] => depthZeroNodes(node.childNodes),
}
