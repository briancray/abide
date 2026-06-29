import type { Binding } from './types/Binding.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/* The structural shape of a `snippet` declaration (`<template name="row" args={item}>`),
   resolved once so the build and SSR back-ends share one reading of it and only own emission.
   Both previously read the name, the raw `args` source, and the body straight off the node.
   The `args` params are now classified ONCE here as `bindings` (`plain` — real call
   parameters, not cells), the single source both back-ends register through `withBindings`. */
export type SnippetPlan = {
    /* The snippet's name — the hoisted builder function's identifier and call name. */
    name: string
    /* The raw `args` source spliced into the builder's parameter list, or undefined. */
    params: string | undefined
    /* The snippet body. */
    children: TemplateNode[]
    /* The body's bindings: the `args` params (`plain`); empty when the snippet takes none. */
    bindings: Binding[]
}

/* Reads a `snippet` node's structure into the shared structural plan. */
export function snippetPlan(node: Extract<TemplateNode, { kind: 'snippet' }>): SnippetPlan {
    return {
        name: node.name,
        params: node.params,
        children: node.children,
        bindings: node.params === undefined ? [] : [{ name: node.params, classification: 'plain' }],
    }
}
