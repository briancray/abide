import type { TemplateNode } from './types/TemplateNode.ts'

/*
A control-flow block — `if`/`each`/`await`/`switch`/`try`. In a skeleton each mounts at an
`<!--a-->` anchor cloned into its located parent at the block's position (see `anchorCursor`),
so a block can sit ANYWHERE among static siblings. The shared classification under block
anchor placement: both back-ends — and `skeletonable` — consult this so they agree on which
nodes are anchor-positioned, the way `componentWrapperTag`/`isTextLeaf` already are.
*/
export function isControlFlow(node: TemplateNode): boolean {
    return (
        node.kind === 'if' ||
        node.kind === 'each' ||
        node.kind === 'await' ||
        node.kind === 'switch' ||
        node.kind === 'try'
    )
}
