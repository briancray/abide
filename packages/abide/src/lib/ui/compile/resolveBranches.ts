import type { TemplateNode } from './types/TemplateNode.ts'

type Branch = Extract<TemplateNode, { kind: 'branch' }>
type BranchName = Branch['branch']

/* Extracts the `then`/`catch`/`finally` branch children of a control-flow block
   (await/try), one slot per requested name in the order asked, so callers
   destructure them directly. A requested branch that is absent yields `undefined`
   — the caller reads `?.children`/`?.as` for its content and bound var. This is
   the one branch-lookup site both back-ends share, replacing the per-generator
   `findBranch`/`branchNamed`/`branchChildren`/`branchVar` copies. */
export function resolveBranches(
    node: Extract<TemplateNode, { children: TemplateNode[] }>,
    ...which: BranchName[]
): (Branch | undefined)[] {
    return which.map((name) =>
        node.children.find(
            (child): child is Branch => child.kind === 'branch' && child.branch === name,
        ),
    )
}
