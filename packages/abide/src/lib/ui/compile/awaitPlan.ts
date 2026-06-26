import { resolveBranches } from './resolveBranches.ts'
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
    return {
        blocking: node.blocking,
        pending: node.blocking ? [] : nonBranch,
        resolvedChildren: node.blocking ? nonBranch : (thenBranch?.children ?? []),
        resolvedAs: (node.blocking ? node.as : thenBranch?.as) ?? '_value',
        catchChildren: catchBranch?.children ?? [],
        catchAs: catchBranch?.as ?? '_error',
        finallyChildren,
        surfaceRejection: catchBranch === undefined && finallyChildren.length === 0,
    }
}
