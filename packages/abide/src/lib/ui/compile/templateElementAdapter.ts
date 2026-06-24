import { OUTLET_TAG } from '../runtime/OUTLET_TAG.ts'
import { isControlFlow } from './isControlFlow.ts'
import { isTextLeaf } from './isTextLeaf.ts'
import type { TemplateNode } from './types/TemplateNode.ts'
import type { ElementRole, ElementWalkAdapter } from './walkElementOrder.ts'

/*
The template-AST side of the shared element-hole numbering rule (`walkElementOrder`). Classifies
each parsed node by the SAME holes the parsed-DOM side recovers (`domElementAdapter`), so the
compiler's `elIndex` numbering and the runtime's `HOLE_ATTRIBUTE` path collection cannot
disagree.

A skeleton element is a numbered element (descended into); it is a HOLE when it carries a
reactive attribute/listener/bind, or binds reactive text marker-free as a text leaf — exactly
the elements `generateSkeleton` stamps with `HOLE_ATTRIBUTE`. A control-flow block, component,
snippet, `<slot>`, or outlet is a fresh build context (its content numbers in its own skeleton),
and a text/script/style/branch/case carries no element index — all skip.
*/
export const templateElementAdapter: ElementWalkAdapter<TemplateNode> = {
    classify: (node: TemplateNode): ElementRole => {
        /* Fresh build contexts — their content is numbered by their own skeleton, not here. */
        if (isControlFlow(node) || node.kind === 'component' || node.kind === 'snippet') {
            return { kind: 'skip' }
        }
        if (node.kind !== 'element') {
            return { kind: 'skip' } // text / script / style / standalone branch|case
        }
        /* A `<slot>` fill point or a layout outlet — fresh context (slot fallback / outlet has
           none), anchor-positioned, never an element hole. */
        if (node.tag === 'slot' || node.tag === OUTLET_TAG) {
            return { kind: 'skip' }
        }
        const hasReactiveAttr = node.attrs.some((attr) => attr.kind !== 'static')
        const hasReactiveTextChild = node.children.some(
            (child) => child.kind === 'text' && child.parts.some((part) => part.kind !== 'static'),
        )
        return {
            kind: 'element',
            isHole: hasReactiveAttr || (hasReactiveTextChild && isTextLeaf(node)),
        }
    },
    childrenOf: (node: TemplateNode): readonly TemplateNode[] =>
        'children' in node ? node.children : [],
}
