import type { TemplateNode } from './TemplateNode.ts'

/*
The per-node skeleton position both back-ends consult so their marker placement
cannot drift. `inSkeleton` is true when a node sits inside a parser-backed skeleton
clone (so control-flow blocks and `<slot>`s take an `<!--a-->` anchor at their
position); `markText` is true when, additionally, the node's reactive text is
interleaved with element siblings (so it takes an `<!--a-->` anchor rather than
binding marker-free on a text-leaf element). Keyed by node identity — both maps are
filled by one shared `skeletonContext` pass over the parsed tree.
*/
export type SkeletonContext = {
    inSkeleton: WeakMap<TemplateNode, boolean>
    markText: WeakMap<TemplateNode, boolean>
    /* Per-hole indices assigned in the same walk, so `generateBuild` reads its `sk.el`/`sk.an`
       numbering rather than re-deriving it. `elIndex` keyed by element/component node;
       `anIndex` keyed by control-flow/slot node OR by a reactive text PART object (a text node
       carries one anchor per reactive part). */
    elIndex: WeakMap<TemplateNode, number>
    anIndex: WeakMap<object, number>
}
