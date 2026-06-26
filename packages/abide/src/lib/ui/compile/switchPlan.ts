import type { TemplateNode } from './types/TemplateNode.ts'

type Case = Extract<TemplateNode, { kind: 'case' }>

/* The structural shape of a `switch`, resolved once so the build and SSR back-ends share one
   reading of its cases and only own emission. Both previously recomputed the `case` filter;
   SSR additionally located the match-less default. */
export type SwitchPlan = {
    /* The `case` branches in source order (`match` set; the default leaves it unset). */
    cases: Case[]
    /* The match-less default branch, if present. */
    fallback: Case | undefined
}

/* Resolves a `switch` node's cases into the shared structural plan. */
export function switchPlan(node: Extract<TemplateNode, { kind: 'switch' }>): SwitchPlan {
    const cases = node.children.filter((child): child is Case => child.kind === 'case')
    return {
        cases,
        fallback: cases.find((branch) => branch.match === undefined),
    }
}
