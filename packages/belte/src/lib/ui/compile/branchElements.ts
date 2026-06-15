import type { TemplateNode } from './types/TemplateNode.ts'

/*
The element roots of a control-flow branch (`if`/`else`/`switch case`/`await
then|catch`). A branch may hold one or MORE top-level elements — each becomes a
root the block tracks as a range. Whitespace-only text between/around them is
dropped (so SSR and the client build agree on the node set, keeping hydration
aligned). Any other top-level content — meaningful text, a component, or a nested
control-flow `<template>` — must be wrapped in an element; it throws a clear error
rather than silently dropping (full fragment roots are a separate feature).

Both back-ends call this, so the server HTML and the client build contain exactly
the same roots in the same order.
*/
type ElementNode = Extract<TemplateNode, { kind: 'element' }>

export function branchElements(
    children: TemplateNode[],
    context: string,
    allowEmpty = false,
): ElementNode[] {
    const elements: ElementNode[] = []
    for (const child of children) {
        if (child.kind === 'element') {
            elements.push(child)
            continue
        }
        /* Whitespace-only text is layout noise between roots — drop it. */
        if (child.kind === 'text' && isWhitespaceOnly(child)) {
            continue
        }
        throw new Error(
            `[belte] ${context} content must be element(s); wrap text / components / nested <template> in an element`,
        )
    }
    if (elements.length === 0 && !allowEmpty) {
        throw new Error(`[belte] ${context} must contain at least one element`)
    }
    return elements
}

/* A text node whose parts are all whitespace literals (no interpolation). */
function isWhitespaceOnly(node: Extract<TemplateNode, { kind: 'text' }>): boolean {
    return node.parts.every((part) => part.kind === 'static' && part.value.trim() === '')
}
