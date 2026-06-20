import { isControlFlow } from './isControlFlow.ts'
import { isTextLeaf } from './isTextLeaf.ts'
import { skeletonable } from './skeletonable.ts'
import type { SkeletonContext } from './types/SkeletonContext.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/*
The single source of truth for where skeleton markers go. One top-down walk records,
per node, whether it sits inside a parser-backed skeleton clone (`inSkeleton`) and
whether its reactive text is interleaved (`markText`) — the two facts that decide
`<!--a-->` anchor placement. Both back-ends read this instead of re-deriving the
position (the client structurally, the server as mutable traversal state), which is
what let them drift: a fresh-context boundary the server forgot to reset leaked an
anchor the client never emitted, desyncing hydration.

A fresh-context boundary resets to NOT-in-skeleton, because the content there is
built by its own runtime (a control-flow block's branch, a component's slot content,
a `<slot>`'s fallback, a snippet's body) — never cloned by the enclosing skeleton —
so an enclosing skeletonable subtree must not stamp markers onto it. Enumerating
every such boundary HERE, once, makes "forgetting to reset one" impossible.
*/
export function skeletonContext(nodes: TemplateNode[]): SkeletonContext {
    const inSkeleton = new WeakMap<TemplateNode, boolean>()
    const markText = new WeakMap<TemplateNode, boolean>()

    /* Walk `node` carrying the context that applies AT it; recurse into children with the
       context that applies to THEM. */
    function visit(node: TemplateNode, nodeInSkeleton: boolean, nodeMarkText: boolean): void {
        inSkeleton.set(node, nodeInSkeleton)
        markText.set(node, nodeMarkText)

        /* Control-flow branches, component slot content, and snippet bodies are fresh build
           contexts — their children re-enter the skeleton only via their own skeletonable
           elements, so reset both flags. (A standalone branch/case is reached as a child of
           its control-flow node and likewise resets.) */
        if (isControlFlow(node) || node.kind === 'component' || node.kind === 'snippet') {
            for (const child of childrenOf(node)) {
                visit(child, false, false)
            }
            return
        }
        /* A `branch`/`case` is a transparent grouping inside its control-flow block (its
           children are generated directly, the wrapper never emits markup) — pass the
           already-reset context through so a skeletonable element inside it re-enters. */
        if (node.kind === 'branch' || node.kind === 'case') {
            for (const child of node.children) {
                visit(child, nodeInSkeleton, nodeMarkText)
            }
            return
        }
        if (node.kind !== 'element') {
            return // text / script / style carry no skeleton children
        }
        if (node.tag === 'slot') {
            /* The slot's own children are its fallback — a fresh context built by `mountSlot`,
               not the enclosing clone. */
            for (const child of node.children) {
                visit(child, false, false)
            }
            return
        }
        /* A skeletonable element not already in a skeleton opens one; its descendants are in
           skeleton. Reactive text interleaves (takes an anchor) unless this element is a
           text-leaf (only text/style children), which binds its text marker-free. */
        const childInSkeleton = nodeInSkeleton || skeletonable(node)
        const childMarkText = childInSkeleton && !isTextLeaf(node)
        for (const child of node.children) {
            visit(child, childInSkeleton, childMarkText)
        }
    }

    for (const node of nodes) {
        visit(node, false, false)
    }
    return { inSkeleton, markText }
}

/* The child list of any node that has one (control-flow, component, snippet, element);
   `[]` for the leaf kinds (text/script/style). `isControlFlow` is not a type guard, so the
   `in` check is what narrows the union for the fresh-context branch. */
function childrenOf(node: TemplateNode): TemplateNode[] {
    return 'children' in node ? node.children : []
}
