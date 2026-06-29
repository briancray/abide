import type { Binding } from './types/Binding.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

type Case = Extract<TemplateNode, { kind: 'case' }>

/* The structural shape of an `if` chain, resolved once so the build and SSR back-ends share
   one partition of its children and only own emission. Both previously recomputed the
   then-content / branch split and the elseif/else classification. An `if`/`elseif`/`else`
   introduces no names, so `bindings` is empty — present so every block plan answers the
   single binding source uniformly. */
export type IfPlan = {
    /* The `then` content — every child that is not an `elseif`/`else` branch. */
    thenChildren: TemplateNode[]
    /* The `elseif`/`else` branches in source order (each a `case` node: `condition` set for
       `elseif`, both unset for `else`). */
    branches: Case[]
    /* Any branch carries a condition → a cond-chain (the build lowers it through `switchBlock`);
       otherwise a binary `if`/`else`. */
    hasElseif: boolean
    /* The match-less `else` branch, if present. */
    elseBranch: Case | undefined
    /* An `if` chain binds no names. */
    bindings: Binding[]
}

/* Partitions an `if` node's children into the shared structural plan. */
export function ifPlan(node: Extract<TemplateNode, { kind: 'if' }>): IfPlan {
    const branches = node.children.filter((child): child is Case => child.kind === 'case')
    return {
        thenChildren: node.children.filter((child) => child.kind !== 'case'),
        branches,
        hasElseif: branches.some((branch) => branch.condition !== undefined),
        elseBranch: branches.find((branch) => branch.condition === undefined),
        bindings: [],
    }
}
