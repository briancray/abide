import { OUTLET_TAG } from '../runtime/OUTLET_TAG.ts'
import { isAnchorPositioned } from './isAnchorPositioned.ts'
import { isControlFlow } from './isControlFlow.ts'
import { isTextLeaf } from './isTextLeaf.ts'
import { skeletonable } from './skeletonable.ts'
import type { SkeletonContext } from './types/SkeletonContext.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/*
The single source of truth for where skeleton markers go AND what their hole indices are.
One top-down walk records, per node, whether it sits inside a parser-backed skeleton clone
(`inSkeleton`) and whether its reactive text is interleaved (`markText`) — the two facts
that decide `<!--a-->` anchor placement — and assigns each hole its `el`/`an` index.
`generateBuild` reads these indices instead of threading its own counter through a second
document-order walk, so the numbering cannot drift from the decisions: one walk owns both.

The index assignment is scoped per skeleton root (a `skeletonable` element not already in a
skeleton — the unit `generateSkeleton` instantiates with `{ el: 0, an: 0 }`). `el` numbers
element holes in pre-order; `an` numbers anchor holes (interleaved reactive text PARTS,
control-flow blocks, child components, `<slot>` outlets) in
document order — the orders the runtime's `indexElementHoles`/`scanAnchors` re-derive from
the realized DOM, so the compile-time numbers and the runtime positions line up.

A fresh-context boundary resets to NOT-in-skeleton (and to no active counter), because the
content there is built by its own runtime (a control-flow block's branch, a component's slot
content, a `<slot>`'s fallback, a snippet's body) — never cloned by the enclosing skeleton.
*/
export function skeletonContext(nodes: TemplateNode[]): SkeletonContext {
    const inSkeleton = new WeakMap<TemplateNode, boolean>()
    const markText = new WeakMap<TemplateNode, boolean>()
    /* Element holes keyed by node; anchor holes keyed by node (control-flow/component/slot)
       OR by the reactive text PART object (a text node carries one anchor per reactive part). */
    const elIndex = new WeakMap<TemplateNode, number>()
    const anIndex = new WeakMap<object, number>()

    type Counter = { el: number; an: number }

    /* Walk `node` carrying the context AND the active skeleton counter that apply AT it
       (`counter === undefined` outside any skeleton — no holes are numbered there). */
    function visit(
        node: TemplateNode,
        nodeInSkeleton: boolean,
        nodeMarkText: boolean,
        counter: Counter | undefined,
    ): void {
        inSkeleton.set(node, nodeInSkeleton)
        markText.set(node, nodeMarkText)

        /* Control-flow blocks, components, and snippets are fresh build contexts. The node
           ITSELF is a hole in the enclosing skeleton (an `<!--a-->` anchor for a block OR a
           component — both mount as a marker-bounded range at that anchor); its children
           re-enter the skeleton only via their own roots. */
        if (isControlFlow(node) || node.kind === 'component' || node.kind === 'snippet') {
            /* A block or a component takes an anchor only inside an enclosing skeleton (a
               standalone one routes through `generateIf`/`mountChild`, not the skeleton path);
               a snippet declares a builder and is never anchor-positioned (`isAnchorPositioned`). */
            if (counter !== undefined && isAnchorPositioned(node)) {
                anIndex.set(node, counter.an++)
            }
            for (const child of childrenOf(node)) {
                visit(child, false, false, undefined)
            }
            return
        }
        /* A `branch`/`case` is a transparent grouping inside its control-flow block — pass the
           already-reset context (and absent counter) through so a skeletonable element inside
           it opens its own skeleton. */
        if (node.kind === 'branch' || node.kind === 'case') {
            for (const child of node.children) {
                visit(child, nodeInSkeleton, nodeMarkText, counter)
            }
            return
        }
        if (node.kind === 'text') {
            /* Interleaved reactive text (markText true): each reactive part takes an `<!--a-->`
               anchor, numbered in document order. A text-leaf's text (markText false) binds
               marker-free via the element, so its parts take no anchor. */
            if (counter !== undefined && nodeMarkText) {
                for (const part of node.parts) {
                    if (part.kind !== 'static') {
                        anIndex.set(part, counter.an++)
                    }
                }
            }
            return
        }
        if (node.kind !== 'element') {
            return // script / style carry no skeleton children and no hole
        }
        if (node.tag === 'slot' || node.tag === OUTLET_TAG) {
            /* A component `<slot>` content fill OR a layout's `OUTLET_TAG` router fill point
               (`asOutlet`) is an anchor hole in the enclosing skeleton — both mount a marker
               range at the anchor (`mountSlot` / `outlet`). A `<slot>`'s children are its
               fallback (a fresh context); an outlet has none. */
            if (counter !== undefined) {
                anIndex.set(node, counter.an++)
            }
            for (const child of node.children) {
                visit(child, false, false, undefined)
            }
            return
        }
        /* A skeletonable element not already in a skeleton OPENS one (a fresh counter — the
           `generateSkeleton` unit). An element already in a skeleton uses the enclosing
           counter. A static element outside any skeleton numbers nothing. */
        const opensSkeleton = !nodeInSkeleton && skeletonable(node)
        const childInSkeleton = nodeInSkeleton || skeletonable(node)
        const effectiveCounter = nodeInSkeleton
            ? counter
            : opensSkeleton
              ? { el: 0, an: 0 }
              : undefined
        const childMarkText = childInSkeleton && !isTextLeaf(node)

        if (effectiveCounter !== undefined) {
            /* The element is a located hole when it carries a reactive attr/listener/bind, or
               binds text-leaf reactive text on itself. Take its `el` index BEFORE recursing,
               so holes number in pre-order — the order the runtime's path walk produces them. */
            const hasReactiveAttr = node.attrs.some((attr) => attr.kind !== 'static')
            const reactiveTextChild = node.children.find(
                (child) =>
                    child.kind === 'text' && child.parts.some((part) => part.kind !== 'static'),
            )
            const textLeafBind = reactiveTextChild !== undefined && isTextLeaf(node)
            if (hasReactiveAttr || textLeafBind) {
                elIndex.set(node, effectiveCounter.el++)
            }
        }
        for (const child of node.children) {
            visit(child, childInSkeleton, childMarkText, effectiveCounter)
        }
    }

    for (const node of nodes) {
        visit(node, false, false, undefined)
    }
    return { inSkeleton, markText, elIndex, anIndex }
}

/* The child list of any node that has one (control-flow, component, snippet, element);
   `[]` for the leaf kinds (text/script/style). `isControlFlow` is not a type guard, so the
   `in` check is what narrows the union for the fresh-context branch. */
function childrenOf(node: TemplateNode): TemplateNode[] {
    return 'children' in node ? node.children : []
}
