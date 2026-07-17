import { RANGE_CLOSE, RANGE_OPEN } from '../runtime/RANGE_MARKER.ts'
import { RENDER } from '../runtime/RENDER.ts'
import type { UiProps } from '../runtime/types/UiProps.ts'
import { adoptRange } from './adoptRange.ts'
import { fillRange } from './fillRange.ts'
import { openMarker } from './openMarker.ts'

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

`bracket` names the range's boundary markers. It defaults to the anonymous `[`/`]` a
control-flow re-fill and the swapped-in inner range of a streamed child use; `mountChild`
passes the ADDRESSED `abide:c:PATH` pair (ADR-0049) so a component's range carries its own
render-path — the same markers on create and SSR (congruent) and a named close a desync can
discard to.
*/
// @documentation plumbing
export function mountRange(
    parent: Node,
    build: (host: Node, props?: UiProps) => void,
    props: UiProps | undefined,
    before: Node | null = null,
    bracket: { open: string; close: string } = DEFAULT_BRACKET,
): { start: Comment; end: Comment; dispose: () => void } {
    const hydration = RENDER.hydration
    const start = openMarker(parent, bracket.open, before)
    if (hydration === undefined) {
        const end = openMarker(parent, bracket.close, before)
        return fillRange(start, end, build, props)
    }
    /* Hydrate: adopt the server range in place, claiming `bracket.close` as the end marker. */
    return adoptRange(parent, build, props, start, bracket.close)
}

const DEFAULT_BRACKET = { open: RANGE_OPEN, close: RANGE_CLOSE }
