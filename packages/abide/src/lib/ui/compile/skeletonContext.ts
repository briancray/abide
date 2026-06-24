import { OUTLET_TAG } from '../runtime/OUTLET_TAG.ts'
import { isControlFlow } from './isControlFlow.ts'
import { isTextLeaf } from './isTextLeaf.ts'
import { skeletonable } from './skeletonable.ts'
import { templateAnchorAdapter } from './templateAnchorAdapter.ts'
import { templateElementAdapter } from './templateElementAdapter.ts'
import type { SkeletonContext } from './types/SkeletonContext.ts'
import type { TemplateNode } from './types/TemplateNode.ts'
import { walkAnchorOrder } from './walkAnchorOrder.ts'
import { walkElementOrder } from './walkElementOrder.ts'

/*
The single source of truth for where skeleton markers go AND what their hole indices are.
One top-down `visit` walk records, per node, whether it sits inside a parser-backed skeleton
clone (`inSkeleton`), whether its reactive text is interleaved (`markText`), and which
`skeletonable` elements OPEN a skeleton (`skeletonRoots`). Both hole axes are then numbered by
the two shared ordering rules — `walkElementOrder` (`el`) and `walkAnchorOrder` (`an`) — run
once per root, so `generateBuild` reads `sk.el`/`sk.an` rather than re-deriving the numbering,
and the runtime recovers the same positions through the SAME two walks. One rule per axis, both
sides; the numbering cannot drift from the decisions.

The index assignment is scoped per skeleton root (a `skeletonable` element not already in a
skeleton — the unit `generateSkeleton` instantiates with a fresh `{ el: 0, an: 0 }`). `el`
numbers element holes in pre-order (the root element itself can be one); `an` numbers anchor
holes (interleaved reactive text PARTS, control-flow blocks, child components, `<slot>` outlets)
in document order.

A fresh-context boundary resets to NOT-in-skeleton, because the content there is built by its
own runtime (a control-flow block's branch, a component's slot content, a `<slot>`'s fallback,
a snippet's body) — never cloned by the enclosing skeleton.
*/
export function skeletonContext(nodes: TemplateNode[]): SkeletonContext {
    const inSkeleton = new WeakMap<TemplateNode, boolean>()
    const markText = new WeakMap<TemplateNode, boolean>()
    /* Element holes keyed by node; anchor holes keyed by node (control-flow/component/slot) OR
       by the reactive text PART object (a text node carries one anchor per reactive part). Both
       numbered AFTER this context pass by the shared walks, once per skeleton root. */
    const elIndex = new WeakMap<TemplateNode, number>()
    const anIndex = new WeakMap<object, number>()
    /* The skeletonable elements that OPEN a skeleton — each owns a fresh `el`/`an` numbering, so
       the shared walks run once per root. Collected in pre-order here, numbered below. */
    const skeletonRoots: TemplateNode[] = []

    /* Record the boundary context (`inSkeleton`/`markText`) at `node` and collect skeleton
       roots. Hole NUMBERING is no longer threaded here — the two shared walks own it. */
    function visit(node: TemplateNode, nodeInSkeleton: boolean, nodeMarkText: boolean): void {
        inSkeleton.set(node, nodeInSkeleton)
        markText.set(node, nodeMarkText)

        /* Control-flow blocks, components, and snippets are fresh build contexts. The node
           ITSELF is an anchor in the enclosing skeleton (a block OR a component mounts as a
           marker-bounded range at that anchor); its children re-enter the skeleton only via
           their own roots. */
        if (isControlFlow(node) || node.kind === 'component' || node.kind === 'snippet') {
            for (const child of childrenOf(node)) {
                visit(child, false, false)
            }
            return
        }
        /* A `branch`/`case` is a transparent grouping inside its control-flow block — pass the
           already-reset context through so a skeletonable element inside it opens its own
           skeleton. */
        if (node.kind === 'branch' || node.kind === 'case') {
            for (const child of node.children) {
                visit(child, nodeInSkeleton, nodeMarkText)
            }
            return
        }
        if (node.kind === 'text') {
            return
        }
        if (node.kind !== 'element') {
            return // script / style carry no skeleton children and no hole
        }
        if (node.tag === 'slot' || node.tag === OUTLET_TAG) {
            /* A component `<slot>` content fill OR a layout's `OUTLET_TAG` router fill point
               (`asOutlet`): its children are a fresh context (the `<slot>` fallback / an outlet
               has none). The slot's own anchor is numbered by the shared walk. */
            for (const child of node.children) {
                visit(child, false, false)
            }
            return
        }
        /* A skeletonable element not already in a skeleton OPENS one (the `generateSkeleton`
           unit). An element already in a skeleton stays in it. A static element outside any
           skeleton numbers nothing. */
        const opensSkeleton = !nodeInSkeleton && skeletonable(node)
        const childInSkeleton = nodeInSkeleton || skeletonable(node)
        const childMarkText = childInSkeleton && !isTextLeaf(node)

        if (opensSkeleton) {
            skeletonRoots.push(node)
        }
        for (const child of node.children) {
            visit(child, childInSkeleton, childMarkText)
        }
    }

    for (const node of nodes) {
        visit(node, false, false)
    }

    /* Number element holes via the ONE shared rule (`walkElementOrder`), once per skeleton root
       so each root's holes start at 0 — the element-only pre-order the runtime's clone walk
       re-derives. The walk starts AT the root: the root element itself is a located hole when it
       binds. */
    for (const root of skeletonRoots) {
        let next = 0
        walkElementOrder([root], templateElementAdapter, (node) => {
            elIndex.set(node, next++)
        })
    }

    /* Number anchor holes via the ONE shared rule (`walkAnchorOrder`), once per skeleton root.
       The root's own children are walked — the root element is a located hole, never an
       anchor. */
    const anchorAdapter = templateAnchorAdapter(inSkeleton, markText)
    for (const root of skeletonRoots) {
        let next = 0
        walkAnchorOrder(childrenOf(root), anchorAdapter, (position) => {
            anIndex.set(position, next++)
        })
    }

    return { inSkeleton, markText, elIndex, anIndex }
}

/* The child list of any node that has one (control-flow, component, snippet, element);
   `[]` for the leaf kinds (text/script/style). `isControlFlow` is not a type guard, so the
   `in` check is what narrows the union for the fresh-context branch. */
function childrenOf(node: TemplateNode): TemplateNode[] {
    return 'children' in node ? node.children : []
}
