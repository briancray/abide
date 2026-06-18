import { AbideCompileError } from './AbideCompileError.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/*
The roots of a control-flow branch (`if`/`else`/`switch case`/`await
then|catch`/`each` row). A branch may hold one or MORE top-level roots — each
becomes a node the block tracks as a range. A root is an element, a child
component (rendered into its own wrapper element — one tracked node), or a text
node (static or interpolated — the parser merges adjacent text/`{expr}` into one
node, so it's always a single DOM text node, matching the merged SSR text node).
Each is a single detached node on create / claimed node on hydrate, so the server
HTML and client build agree on the node set and hydration stays aligned. Both
back-ends call this, so they see the same roots in the same order.

Whitespace-only text between/around roots is dropped; a scoped `<script>`/`<style>`
emits no root. What is NOT a root — a nested control-flow `<template>` or a snippet
declaration — throws a clear error rather than silently dropping (these still need
wrapping; they are the remaining "full fragment roots" feature). A bare `html\`…\``
or snippet-call value as a branch's sole content should likewise be wrapped (it
expands to a marker range, not one node).
*/
export function branchRoots(
    children: TemplateNode[],
    context: string,
    allowEmpty = false,
    loc?: number,
): TemplateNode[] {
    const roots: TemplateNode[] = []
    for (const child of children) {
        if (child.kind === 'element' || child.kind === 'component') {
            roots.push(child)
            continue
        }
        if (child.kind === 'text') {
            /* Whitespace-only text is layout noise between roots — drop it; any text
               with content is one node (static or reactive). */
            if (!isWhitespaceOnly(child)) {
                roots.push(child)
            }
            continue
        }
        /* A scoped `<script>` is emitted as code by the back-end, not a root; a
           `<style>` is bundled CSS (its scope already stamped on the roots). */
        if (child.kind === 'script' || child.kind === 'style') {
            continue
        }
        /* Point at the offending child's own offset when it has one (a nested
           control-flow `<template>`), else the branch's. */
        throw new AbideCompileError(
            `[abide] ${context} content must be element(s), component(s), or text; ` +
                `wrap a nested <template> / snippet in an element`,
            childLoc(child) ?? loc,
        )
    }
    if (roots.length === 0 && !allowEmpty) {
        throw new AbideCompileError(`[abide] ${context} must contain at least one root`, loc)
    }
    return roots
}

/* The node's primary-expression offset, where the parser tracked one. */
function childLoc(node: TemplateNode): number | undefined {
    return 'loc' in node ? node.loc : undefined
}

/* A text node whose parts are all whitespace literals (no interpolation). */
function isWhitespaceOnly(node: Extract<TemplateNode, { kind: 'text' }>): boolean {
    return node.parts.every((part) => part.kind === 'static' && part.value.trim() === '')
}
