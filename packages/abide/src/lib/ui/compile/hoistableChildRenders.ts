import { declaredNames } from './declaredNames.ts'
import { expressionIsPrefixEvaluable } from './expressionIsPrefixEvaluable.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

type ComponentNode = Extract<TemplateNode, { kind: 'component' }>

/*
ADR-0037 Phase 2 — which `<Child/>` renders may START in the synchronous SSR prefix (as a `$$flight`
awaited at its structural position) so sibling child renders overlap instead of serializing behind
each other's `await Child.render(...)`. A child render is HOISTABLE iff it is on the TOP-LEVEL SPINE
— reachable from the template root through only plain elements, so no control-flow / await-branch /
snippet / slot binder is in scope — AND:

  1. its component reference and every prop value (including a `{...spread}`) are prefix-evaluable:
     no async-cell name (still pending at the prefix, before the barrier) and no nested-`<script>`
     local declared earlier on the spine (those lower at their body position, not the prefix);
  2. it carries NO slot content (`children` empty) — lazily-built slot content would need its own
     prefix-evaluability proof; a childless card is the common parallel case;
  3. no `bind:` prop — a two-way write-back channel that must wire at its structural position.

Off-spine components (inside `{#if}`/`{#for}`/`{#await}`, a snippet, or another component's slot) stay
sequential: conservatively excluded rather than proven row/branch-safe. Fail-closed throughout — any
doubt leaves the render sequential, never wrong. Server-only; the client build is untouched.
*/
export function hoistableChildRenders(
    nodes: TemplateNode[],
    cellReadNames: ReadonlySet<string>,
): Set<ComponentNode> {
    const hoistable = new Set<ComponentNode>()
    /* Every `{#snippet name}` in the component is a hoisted builder that may itself render an
       async cell / await; a prop passing one to a child (`<List item={row}/>`) must therefore NOT
       hoist — calling `row()` early, in the prefix, would render it out of order. Seed the binder set
       with all snippet names (collected tree-wide, since a snippet is in scope for the whole
       component) so any prop referencing one fails the prefix-evaluability check. */
    const binders = new Set<string>()
    collectSnippetNames(nodes, binders)
    walkSpine(nodes, binders, cellReadNames, hoistable)
    return hoistable
}

/* Recursively collect every `{#snippet name}` name in the subtree into `into`. */
function collectSnippetNames(list: TemplateNode[], into: Set<string>): void {
    for (const node of list) {
        if (node.kind === 'snippet') {
            into.add(node.name)
        }
        if ('children' in node && Array.isArray(node.children)) {
            collectSnippetNames(node.children, into)
        }
    }
}

/* Walk a spine sibling list left-to-right: a `<script>` sibling's locals bind the siblings that
   follow it; a component is judged in the running binder context; a plain element descends (still on
   the spine). Every other node kind leaves the spine and is not descended — its components stay
   sequential. */
function walkSpine(
    list: TemplateNode[],
    binders: ReadonlySet<string>,
    cellReadNames: ReadonlySet<string>,
    hoistable: Set<ComponentNode>,
): void {
    let running = binders
    for (const node of list) {
        if (node.kind === 'script') {
            running = union(running, declaredNames(node.code))
            continue
        }
        if (node.kind === 'component') {
            if (componentIsHoistable(node, running, cellReadNames)) {
                hoistable.add(node)
            }
            /* Slot children are off-spine (built lazily inside the child) — not descended. */
            continue
        }
        if (node.kind === 'element' && 'children' in node) {
            walkSpine(node.children, running, cellReadNames, hoistable)
        }
        /* if / switch / each / await / try / snippet / branch: off the spine, skip. */
    }
}

/* Childless, bind-free, with a prefix-evaluable tag and every prop value prefix-evaluable. */
function componentIsHoistable(
    node: ComponentNode,
    binders: ReadonlySet<string>,
    cellReadNames: ReadonlySet<string>,
): boolean {
    if (node.children.length > 0) {
        return false
    }
    if (!expressionIsPrefixEvaluable(node.name, binders, cellReadNames)) {
        return false
    }
    for (const prop of node.props) {
        if (prop.bind === true) {
            return false
        }
        if (!expressionIsPrefixEvaluable(prop.code, binders, cellReadNames)) {
            return false
        }
    }
    return true
}

function union(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
    const result = new Set(a)
    for (const value of b) {
        result.add(value)
    }
    return result
}
