import type { UiProps } from '../runtime/types/UiProps.ts'
import { disposeRange } from './disposeRange.ts'
import { fillBefore } from './fillBefore.ts'
import { withScope } from './withScope.ts'

/*
Builds a component's content fresh between two existing range markers (the create
path), under the component's own lexical scope and render pass — the range analog of
`mount` for a nested child. `build` appends into a fragment (via `fillBefore`) that
lands just before `end`, so the content sits in the `[ … ]` range the child mounts
into rather than at the parent's tail; that range is what makes a component
selector-transparent (a true direct child of its parent, no `<abide-name>` wrapper).

Brackets a render pass (a nested child continues the parent's block-id counter) and
establishes the child's lexical scope in `awaiting` mode so it adopts the model doc
its first `doc()` creates. The disposer stops the content's reactivity, disposes the
lexical scope, and clears the range — leaving the markers, so a later rebuild
(navigation, control-flow re-fill) fills in place. Shared by `mountRange` (create
branch) and `fillBoundary` (a page/layout outlet boundary).
*/
// @documentation plumbing
export function fillRange(
    start: Comment,
    end: Comment,
    build: (host: Node, props?: UiProps) => void,
    props: UiProps | undefined,
    label: string | undefined,
): { start: Comment; end: Comment; dispose: () => void } {
    const scoped = withScope(label, () => fillBefore(end, (fragment) => build(fragment, props)))
    return { start, end, dispose: disposeRange(scoped, start, end) }
}
