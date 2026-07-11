import { RANGE_CLOSE, RANGE_OPEN } from '../runtime/RANGE_MARKER.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import type { UiProps } from '../runtime/types/UiProps.ts'
import { disposeRange } from './disposeRange.ts'
import { fillRange } from './fillRange.ts'
import { openMarker } from './openMarker.ts'
import { withScope } from './withScope.ts'

/*
Mounts a nested child component as a marker-bounded range — the wrapper-free
replacement for the old `<abide-name display:contents>` host. A component positions
and hydrates exactly like a control-flow block: its content lives in a `[ … ]` range,
so the child's real root is a TRUE direct child of the parent and structural CSS
(`>`, `:first-child`, `space-x`, grid placement) reaches it with no indirection —
which `display:contents` could never give, since it hides the wrapper from layout but
not from the selector tree.

Create fills the range before the end marker (`fillRange`); hydrate claims the server
range in place (claim the start marker, build claims the content, claim the end
marker — mirrors `mountSlot`/`when`). `before` (a skeleton-located node, the block's
`anchorCursor`) places the range among static siblings on create; hydrate ignores it
(the claim cursor drives placement). Returns the markers + a disposer so the hot path
can rebuild in place.
*/
// @documentation plumbing
export function mountRange(
    parent: Node,
    build: (host: Node, props?: UiProps) => void,
    props: UiProps | undefined,
    before: Node | null = null,
): { start: Comment; end: Comment; dispose: () => void } {
    const hydration = RENDER.hydration
    const start = openMarker(parent, RANGE_OPEN, before)
    if (hydration === undefined) {
        const end = openMarker(parent, RANGE_CLOSE, before)
        return fillRange(start, end, build, props)
    }
    /* Hydrate: adopt the server range in place. Establish the child's lexical scope
       and render pass (same as `fillRange`), build claiming the existing nodes, then
       claim the end marker the build's content stops before. */
    const scoped = withScope(() => scope(() => build(parent, props)))
    const end = openMarker(parent, RANGE_CLOSE)
    return { start, end, dispose: disposeRange(scoped, start, end) }
}
