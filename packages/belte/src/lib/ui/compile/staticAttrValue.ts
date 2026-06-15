import type { TemplateNode } from './types/TemplateNode.ts'

/* The value of a static attribute on an element node, or undefined when absent.
   Used to read directive attributes like `slot` / `slot name` off the template. */
export function staticAttrValue(
    node: Extract<TemplateNode, { kind: 'element' }>,
    name: string,
): string | undefined {
    const attr = node.attrs.find(
        (candidate) => candidate.kind === 'static' && candidate.name === name,
    )
    return attr !== undefined && attr.kind === 'static' ? attr.value : undefined
}
