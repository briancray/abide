import { OUTLET_TAG } from '../runtime/OUTLET_TAG.ts'
import { isControlFlow } from './isControlFlow.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/*
The node kinds that mount as a marker range and so take an `<!--a-->` anchor when in a
skeleton — control-flow, child component, and the two outlet elements (a layout's
`OUTLET_TAG`, a component's `<slot>`). The single positioning predicate every back-end
shares — `generateSSR` gates its anchor emission on it, `skeletonContext` gates its anchor
indexing on it — so SSR, the client clone, and the shared numberer cannot disagree on which
nodes anchor.
*/
export function isAnchorPositioned(node: TemplateNode): boolean {
    return (
        isControlFlow(node) ||
        node.kind === 'component' ||
        (node.kind === 'element' && (node.tag === OUTLET_TAG || node.tag === 'slot'))
    )
}
