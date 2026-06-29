import { catchBinding } from './catchBinding.ts'
import { resolveBranches } from './resolveBranches.ts'
import type { Binding } from './types/Binding.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/* The structural shape of an `await` block, resolved ONCE from the node so the build and
   SSR back-ends share one reading of it and only own emission. Both previously recomputed
   branch resolution, the `finallyChildren` default, the blocking-vs-streaming split of the
   resolved content/binding, and the surface-the-rejection rule — the parts that can silently
   diverge. Same single-source-of-truth model the positional walks already use. */
export type AwaitPlan = {
    /* `then` on the tag → blocking: no pending branch, the children ARE the resolved content
       (settled before first flush). Absent → streaming: pending flushes, `then` resolves later. */
    blocking: boolean
    /* The pending content (streaming) — `[]` when blocking. */
    pending: TemplateNode[]
    /* The resolved content + its bound name: the children-minus-branch bound to `node.as`
       when blocking, the `then` branch bound to its `as` when streaming. `_value` default. */
    resolvedChildren: TemplateNode[]
    resolvedAs: string
    /* The catch content + its bound name (`_error` default); empty when no catch branch. */
    catchChildren: TemplateNode[]
    catchAs: string
    finallyChildren: TemplateNode[]
    /* Neither catch nor finally → a rejection must surface (re-throw / `undefined` catch thunk)
       instead of rendering an empty branch. */
    surfaceRejection: boolean
    /* The resolved branch's binding (`resolvedAs`, `reactive` — a `.value` cell on the
       client, a re-settle updates it in place). One element. */
    resolvedBindings: Binding[]
    /* The catch branch's binding (`catchAs`, `plain`); empty when no catch branch. The
       `finally` branch binds nothing, so it registers no binding. */
    catchBindings: Binding[]
}

/* Resolves an `await` node's branches into the shared structural plan. */
export function awaitPlan(node: Extract<TemplateNode, { kind: 'await' }>): AwaitPlan {
    const [thenBranch, catchBranch, finallyBranch] = resolveBranches(
        node,
        'then',
        'catch',
        'finally',
    )
    const finallyChildren = finallyBranch?.children ?? []
    const nonBranch = node.children.filter((child) => child.kind !== 'branch')
    const resolvedAs = (node.blocking ? node.as : thenBranch?.as) ?? '_value'
    const catchAs = catchBranch?.as ?? '_error'
    return {
        blocking: node.blocking,
        pending: node.blocking ? [] : nonBranch,
        resolvedChildren: node.blocking ? nonBranch : (thenBranch?.children ?? []),
        resolvedAs,
        catchChildren: catchBranch?.children ?? [],
        catchAs,
        finallyChildren,
        surfaceRejection: catchBranch === undefined && finallyChildren.length === 0,
        resolvedBindings: [{ name: resolvedAs, classification: 'reactive' }],
        catchBindings: catchBinding(catchAs, catchBranch !== undefined),
    }
}
