import type { TemplateNode } from './types/TemplateNode.ts'

/*
Document-order (pre-order) numbering of every `<Child/>` mount site in a template — the
ordinal a child's render-path roots under (`mountChild` on the client, `$$withPath(ordinal)`
/ `$$renderPath(ordinal)` on the server). ONE walk both back-ends read (the `skeletonContext`
pattern), replacing the per-back-end `childOrdinal++` counters that numbered components in
each generator's own EMISSION order — an order that could silently diverge (build emits a
component's slot content before taking its own ordinal; SSR emits a switch's default case
after later cases). Numbering from the tree, not the emission, makes SSR↔client ordinal
congruence hold by construction.
*/
export function componentOrdinals(nodes: TemplateNode[]): WeakMap<TemplateNode, number> {
    const ordinals = new WeakMap<TemplateNode, number>()
    let next = 0
    const walk = (children: TemplateNode[]): void => {
        for (const child of children) {
            if (child.kind === 'component') {
                ordinals.set(child, next)
                next += 1
            }
            if ('children' in child) {
                walk(child.children)
            }
        }
    }
    walk(nodes)
    return ordinals
}
