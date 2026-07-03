import { claimChild } from '../runtime/claimChild.ts'
import { RANGE_CLOSE, RANGE_OPEN } from '../runtime/RANGE_MARKER.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scheduleWake } from '../runtime/scheduleWake.ts'
import { scope } from '../runtime/scope.ts'
import type { UiProps } from '../runtime/types/UiProps.ts'
import { clearBetween } from './clearBetween.ts'
import { commentData } from './commentData.ts'
import { disposeRange } from './disposeRange.ts'
import { fillRange } from './fillRange.ts'
import { firstElementBetween } from './firstElementBetween.ts'
import { markerDepthDelta } from './markerDepthDelta.ts'
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

`clientTrigger` marks the component an ISLAND: on hydrate its server markup is kept
verbatim and its build is SKIPPED, then run on the trigger (`'idle'`/`'visible'`) —
so a below-the-fold widget ships as HTML and wires no effects until scrolled to (or
the first idle gap), off the critical boot path. Create ignores it (there is no server
markup to keep — an island is a hydration-cost optimization). See `adoptIsland`.
*/
// @documentation plumbing
export function mountRange(
    parent: Node,
    build: (host: Node, props?: UiProps) => void,
    props: UiProps | undefined,
    before: Node | null = null,
    label: string | undefined = undefined,
    clientTrigger: 'idle' | 'visible' | undefined = undefined,
): { start: Comment; end: Comment; dispose: () => void } {
    const hydration = RENDER.hydration
    const start = openMarker(parent, RANGE_OPEN, before)
    if (hydration === undefined) {
        const end = openMarker(parent, RANGE_CLOSE, before)
        return fillRange(start, end, build, props, label)
    }
    if (clientTrigger !== undefined) {
        return adoptIsland(parent, start, build, props, label, clientTrigger, hydration)
    }
    /* Hydrate: adopt the server range in place. Establish the child's lexical scope
       and render pass (same as `fillRange`), build claiming the existing nodes, then
       claim the end marker the build's content stops before. */
    const scoped = withScope(label, () => scope(() => build(parent, props)))
    const end = openMarker(parent, RANGE_CLOSE)
    return { start, end, dispose: disposeRange(scoped, start, end) }
}

/*
Island hydration: keep the server markup, skip the build, wake it later on the trigger. Scan the
child's server nodes to THIS range's depth-matched close (`markerDepthDelta` balances nested
`[`…`]` / `abide:` ranges) — keeping them and advancing the claim cursor past them, so the rest
of the page hydrates around the skipped subtree — then claim the close marker. No scope is built,
so the inert disposer only clears the kept nodes; the wake clears them and builds the child fresh
(hydration off) between the same markers, exactly like a create-path mount.
*/
function adoptIsland(
    parent: Node,
    start: Comment,
    build: (host: Node, props?: UiProps) => void,
    props: UiProps | undefined,
    label: string | undefined,
    trigger: 'idle' | 'visible',
    hydration: NonNullable<(typeof RENDER)['hydration']>,
): { start: Comment; end: Comment; dispose: () => void } {
    const firstKept = claimChild(hydration, parent)
    let node = firstKept
    let depth = 0
    while (node !== null) {
        const data = commentData(node)
        if (data !== undefined) {
            const delta = markerDepthDelta(data)
            /* A depth-0 close is THIS range's own; anything nested balances out first. */
            if (delta === -1 && depth === 0) {
                break
            }
            depth += delta
        }
        node = node.nextSibling
    }
    hydration.next.set(parent, node)
    const end = openMarker(parent, RANGE_CLOSE)

    /* Inert: no scope/effects for the kept nodes, so disposal only evicts the range. The wake
       swaps in a real build whose own disposer replaces this one. */
    let disposeContent = (): void => clearBetween(start, end)
    const wake = (): void => {
        disposeContent()
        const previous = RENDER.hydration
        RENDER.hydration = undefined
        try {
            disposeContent = fillRange(start, end, build, props, label).dispose
        } finally {
            RENDER.hydration = previous
        }
    }
    const cancelWake = scheduleWake(trigger, firstElementBetween(firstKept, end), wake)
    return {
        start,
        end,
        dispose: () => {
            cancelWake()
            disposeContent()
        },
    }
}
