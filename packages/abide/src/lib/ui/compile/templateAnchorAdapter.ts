import { isAnchorPositioned } from './isAnchorPositioned.ts'
import type { TemplateNode } from './types/TemplateNode.ts'
import type { AnchorRole, AnchorWalkAdapter } from './walkAnchorOrder.ts'

/*
The template-AST side of the shared anchor-ordering rule (`walkAnchorOrder`). Classifies each
parsed node by the SAME positions the realized-DOM side recovers, so the compiler's `anIndex`
numbering and the runtime's `scanAnchors` collection cannot disagree.

Anchor positions, in document order: a control-flow/component node and a `<slot>`/outlet
element each contribute themselves (one anchor, fresh-context body — not descended); a text
node whose reactive parts are interleaved contributes one anchor per non-static part. A
skeleton-structure element is a container we descend; everything else (static text, a
text-leaf's marker-free text, script/style, a node outside any skeleton) contributes nothing.

`inSkeleton`/`markText` come from the context pass (the element-hole + boundary axes), read here
so the adapter stays a pure classifier — the anchor counter never re-derives the context.
*/
export function templateAnchorAdapter(
    inSkeleton: WeakMap<TemplateNode, boolean>,
    markText: WeakMap<TemplateNode, boolean>,
): AnchorWalkAdapter<TemplateNode> {
    return {
        classify: (node: TemplateNode): AnchorRole => {
            /* A node outside an active skeleton numbers nothing — its block/text mounts on the
               host directly (top-level / inside a branch), no anchor. */
            if (inSkeleton.get(node) !== true) {
                /* It may still be a non-skeleton CONTAINER whose descendants open their own
                   skeletons (a static wrapper element), so recurse into elements, skip leaves. */
                return node.kind === 'element' ? { kind: 'recurse' } : { kind: 'skip' }
            }
            /* An anchor-positioned node IS one anchor and its body is a fresh context. */
            if (isAnchorPositioned(node)) {
                return { kind: 'anchor', positions: [node] }
            }
            /* A component/snippet inside a skeleton that isn't anchor-positioned (a snippet
               declares a builder) — fresh context, no anchor, no descent. */
            if (node.kind === 'component' || node.kind === 'snippet') {
                return { kind: 'skip' }
            }
            /* Interleaved reactive text: one anchor per non-static part, document order. */
            if (node.kind === 'text') {
                return markText.get(node) === true
                    ? {
                          kind: 'anchor',
                          positions: node.parts.filter((part) => part.kind !== 'static'),
                      }
                    : { kind: 'skip' }
            }
            /* A skeleton-structure element — descend into its children. */
            if (node.kind === 'element') {
                return { kind: 'recurse' }
            }
            return { kind: 'skip' }
        },
        /* A branch/case is a transparent grouping inside its block — the context pass already
           records its children's reset state, so the walk descends straight through it. */
        childrenOf: (node: TemplateNode): readonly TemplateNode[] =>
            'children' in node ? node.children : [],
    }
}
