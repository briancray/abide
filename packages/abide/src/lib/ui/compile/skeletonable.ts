import type { TemplateNode } from './types/TemplateNode.ts'

/* A control-flow block — `if`/`each`/`await`/`switch`/`try`. In a skeleton it mounts at an
   `<!--a-->` anchor cloned into the located parent at the block's position (see
   `anchorCursor`), so a block can sit ANYWHERE among static siblings — no contiguity or
   prefix-shape constraint. */
function isControlFlow(node: TemplateNode): boolean {
    return (
        node.kind === 'if' ||
        node.kind === 'each' ||
        node.kind === 'await' ||
        node.kind === 'switch' ||
        node.kind === 'try'
    )
}

/* Whether a subtree is skeleton STRUCTURE — anything the parser-backed clone can carry with
   its holes mounted in place: elements, `<style>`, text (static OR reactive), child
   components (their wrapper element is positioned in the skeleton), control-flow blocks and
   `<slot>` outlets (each anchor-mounted at its position), and emit-nothing nodes — a nested
   `<script>` (a scoped reactive block) and a `<template name>` snippet (a hoisted builder),
   both of which the skeleton's bind list runs in document order, scoped like
   `generateElement` does. Only a standalone `branch`/`case` (consumed by its block, never a
   loose child) disqualifies. */
function skeletonStructure(node: TemplateNode): boolean {
    if (isControlFlow(node) || node.kind === 'component') {
        return true
    }
    if (node.kind === 'style' || node.kind === 'text') {
        return true
    }
    if (node.kind === 'script' || node.kind === 'snippet') {
        return true
    }
    if (node.kind !== 'element') {
        return false // standalone branch|case
    }
    if (node.tag === 'slot') {
        return true
    }
    return node.children.every(skeletonStructure)
}

/* Whether a subtree carries at least one hole — anything needing a runtime bind rather than
   constant markup: a reactive attribute/listener/bind on an element, a reactive text part, a
   control-flow block, a `<slot>` outlet, a child component (each needs a located node or an
   anchor), or a nested `<script>`/snippet (emits no markup but must run). */
function hasHole(node: TemplateNode): boolean {
    if (isControlFlow(node) || node.kind === 'component') {
        return true
    }
    if (node.kind === 'script' || node.kind === 'snippet') {
        return true
    }
    if (node.kind === 'text') {
        return node.parts.some((part) => part.kind !== 'static')
    }
    if (node.kind === 'element') {
        if (node.tag === 'slot') {
            return true
        }
        return node.attrs.some((attr) => attr.kind !== 'static') || node.children.some(hasHole)
    }
    return false
}

/*
A subtree of skeleton structure carrying one or more holes. It builds through the
parser-backed `skeleton` (one clone, correct foreign namespaces) — element holes located by
element-only path, anchor holes (reactive text interleaved with elements, control flow,
slots) by document-order scan — instead of the imperative path. A bound element's reactive
attributes wire to the located node; a text-leaf element's reactive text binds via
`appendText` on it (marker-free, so SSR === client). Fully-static subtrees (no hole) stay on
`cloneStatic`.
*/
export function skeletonable(node: TemplateNode): boolean {
    return (
        node.kind === 'element' && node.tag !== 'slot' && skeletonStructure(node) && hasHole(node)
    )
}
