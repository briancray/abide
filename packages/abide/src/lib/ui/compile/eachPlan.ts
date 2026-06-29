import { resolveBranches } from './resolveBranches.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/* The structural shape of an `each`/`for` loop, resolved once so the build and SSR back-ends
   share one reading of it and only own emission. Both previously read the item/index/key
   names, the `async` split, and the row children straight off the node; build additionally
   resolved the async-each `catch` branch. The binding-name DERIVATION (which names the row
   introduces and under which kind) stays in each back-end this phase — this plan carries only
   the raw structural fields, the same single-source model the positional walks already use. */
export type EachPlan = {
    /* The list expression — an Array (sync) or AsyncIterable (`async`). */
    items: string
    /* The item binding pattern (`node.as`): a plain identifier or a destructuring pattern. */
    as: string
    /* `by={k}` key expression, or undefined → key on the item's own identity. */
    key: string | undefined
    /* `index="i"` → the row's position bound to this name; undefined → unbound. */
    index: string | undefined
    /* `await` on the tag → `items` is an AsyncIterable, drained on the client. */
    async: boolean
    /* The row content. */
    children: TemplateNode[]
    /* The async-each `catch` content + its bound name (`_error` default); empty when absent.
       Build renders it after the streamed rows on iterator rejection; SSR renders no async
       rows so it ignores this. */
    catchChildren: TemplateNode[]
    catchAs: string
    /* No catch → the rejection surfaces instead of rendering an empty branch. */
    hasCatch: boolean
}

/* Resolves an `each` node's structure into the shared structural plan. */
export function eachPlan(node: Extract<TemplateNode, { kind: 'each' }>): EachPlan {
    const [catchBranch] = resolveBranches(node, 'catch')
    return {
        items: node.items,
        as: node.as,
        key: node.key,
        index: node.index,
        async: node.async,
        children: node.children,
        catchChildren: catchBranch?.children ?? [],
        catchAs: catchBranch?.as ?? '_error',
        hasCatch: catchBranch !== undefined,
    }
}
