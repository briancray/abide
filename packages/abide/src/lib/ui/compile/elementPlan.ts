import { classStyleMergePlan } from './classStyleMergePlan.ts'
import type { ElementPlan, ElementPlanAttr } from './types/ElementPlan.ts'
import type { TemplateAttr } from './types/TemplateAttr.ts'
import type { TemplateNode } from './types/TemplateNode.ts'
import { VOID_TAGS } from './VOID_TAGS.ts'

/*
The single decision site for one element's attribute emission — lifted out of the two
hand-mirrored code-gen back-ends (`generateBuild`, `generateSSR`) so the load-bearing
agreement on which attribute is which kind, which class/style parts merge, and which tag
is void lives ONCE (ADR-0013, the locality milestone). Each back-end RENDERS the plan
differently — build wires live effects/thunks, SSR pushes escaped strings — but consults
the same classification, so the markup the client clones and the server emits cannot drift.

`classStyleMergePlan` folds in as the class/style branch. Each attr is tagged `mergedBuild`
/`mergedSSR` from the two merge triggers (build merges only on an interpolated base, SSR on
any directive), so a back-end skips exactly the attrs it folded into its merged class/style
attribute. The positional holes/anchors stay in `skeletonContext`; this plan layers over it.
*/
export function elementPlan(
    node: Extract<TemplateNode, { kind: 'element' }>,
    lower: (code: string) => string,
): ElementPlan {
    const merge = classStyleMergePlan(node.attrs, lower)
    /* True when this attr is folded into the build back-end's merged class/style effect — the
       interpolated base or any directive of a merged property (a static base stays surgical). */
    const isMergedBuild = (attr: TemplateAttr): boolean =>
        (merge.mergeClassBuild && (attr === merge.classBase || attr.kind === 'class')) ||
        (merge.mergeStyleBuild && (attr === merge.styleBase || attr.kind === 'style'))
    /* True when this attr is folded into the SSR back-end's merged class/style attribute,
       whenever a directive exists. A `class:`/`style:` directive always folds; a static or
       interpolated base folds by NAME (so a duplicate `class`/`style` base is folded too,
       never double-emitted next to the merged attribute — the old SSR by-name skip). */
    const isMergedSSR = (attr: TemplateAttr): boolean => {
        if (attr.kind === 'class') {
            return merge.mergeClass
        }
        if (attr.kind === 'style') {
            return merge.mergeStyle
        }
        if (attr.kind === 'static' || attr.kind === 'interpolated') {
            return (
                (attr.name === 'class' && merge.mergeClass) ||
                (attr.name === 'style' && merge.mergeStyle)
            )
        }
        return false
    }
    const attrs: ElementPlanAttr[] = node.attrs.map((attr) => ({
        attr,
        mergedBuild: isMergedBuild(attr),
        mergedSSR: isMergedSSR(attr),
    }))
    return { attrs, merge, isVoid: VOID_TAGS.has(node.tag) }
}
