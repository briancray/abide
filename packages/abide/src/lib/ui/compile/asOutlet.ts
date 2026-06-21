import { OUTLET_TAG } from '../runtime/OUTLET_TAG.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/*
In a layout the `<slot/>` page outlet is a bare empty `OUTLET_TAG` element the router fills
later. Rewriting it to an element node up front lets the static-clone path carry it as ordinary
structure AND lets BOTH back-ends feed the same tree to `skeletonContext` — one decision site
for "a layout slot is an outlet, not an anchor", instead of the client running `asOutlet` while
SSR mirrors it with an inline special-case.

The outlet is a structural mount point, not styled content, so it carries NO attrs and NO style
scope — both back-ends lower it to the bare `<!--abide:outlet-->`…`<!--/abide:outlet-->` boundary
`renderChain` folds the child layer into (matching its `OUTLET_PLACEHOLDER`). Stripping `scopes`
is what makes the two back-ends agree: SSR emits the boundary bare, but without this the client
clone would read the slot's annotated `scopes` and stamp them — a hydration mismatch for any
scoped layout.

Control-flow children are fresh build contexts (their own runtime mounts a nested slot), so they
are not descended into — a `<slot>` inside an `{#if}` stays a slot node, handled at its own
mount site in each back-end.
*/
export function asOutlet(node: TemplateNode): TemplateNode {
    if (node.kind !== 'element') {
        return node
    }
    if (node.tag === 'slot') {
        return { ...node, tag: OUTLET_TAG, attrs: [], children: [], scopes: [] }
    }
    return { ...node, children: node.children.map(asOutlet) }
}
