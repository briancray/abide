import { catchBinding } from './catchBinding.ts'
import { resolveBranches } from './resolveBranches.ts'
import type { Binding } from './types/Binding.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/* The structural shape of a `try` error boundary, resolved once so the build and SSR
   back-ends share one reading and only own emission. Both previously recomputed branch
   resolution, the `finallyChildren` default, the guarded (children-minus-branch) split, and
   the catch binding / presence. */
export type TryPlan = {
    /* The guarded content — every child except the `catch`/`finally` branch nodes. */
    guarded: TemplateNode[]
    /* The catch content + its bound name (`_error` default); empty when no catch branch. */
    catchChildren: TemplateNode[]
    catchAs: string
    finallyChildren: TemplateNode[]
    /* No catch → a throw propagates to the enclosing boundary (re-throw / `undefined` thunk). */
    hasCatch: boolean
    /* The catch branch's binding (`catchAs`, `reactive`); empty when no catch branch. The
       error is a `.value` cell so a catch→catch swap updates `err` in place. The guarded and
       `finally` branches bind nothing. */
    catchBindings: Binding[]
}

/* Resolves a `try` node's branches into the shared structural plan. */
export function tryPlan(node: Extract<TemplateNode, { kind: 'try' }>): TryPlan {
    const [catchBranch, finallyBranch] = resolveBranches(node, 'catch', 'finally')
    const catchAs = catchBranch?.as ?? '_error'
    return {
        guarded: node.children.filter((child) => child.kind !== 'branch'),
        catchChildren: catchBranch?.children ?? [],
        catchAs,
        finallyChildren: finallyBranch?.children ?? [],
        hasCatch: catchBranch !== undefined,
        catchBindings: catchBinding(catchAs, catchBranch !== undefined, true),
    }
}
