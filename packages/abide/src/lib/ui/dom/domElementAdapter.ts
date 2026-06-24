import type { ElementRole, ElementWalkAdapter } from '../compile/walkElementOrder.ts'
import { HOLE_ATTRIBUTE } from '../runtime/HOLE_ATTRIBUTE.ts'
import { isElement } from './isElement.ts'

/*
The parsed-DOM side of the shared element-hole numbering rule (`walkElementOrder`). Classifies
each node of the parsed skeleton by the SAME holes the template-AST side numbered
(`templateElementAdapter`), so the runtime's collected element paths line up with the compiler's
`elIndex`. Runs over the SHALLOW parsed skeleton (blocks/components/slots are already `<!--a-->`
anchors, not elements), so a `HOLE_ATTRIBUTE` element is a hole and every element is descended;
everything else skips. The collected paths resolve against the expanded server DOM separately
(`resolveElementHole`, which skips nested ranges there).
*/
export const domElementAdapter: ElementWalkAdapter<Node> = {
    classify: (node: Node): ElementRole =>
        isElement(node)
            ? { kind: 'element', isHole: node.hasAttribute(HOLE_ATTRIBUTE) }
            : { kind: 'skip' },
    childrenOf: (node: Node): readonly Node[] => Array.from(node.childNodes),
}
