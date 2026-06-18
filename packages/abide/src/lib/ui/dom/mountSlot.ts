import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import { fillBefore } from './fillBefore.ts'
import { openMarker } from './openMarker.ts'

/*
Mounts a component's `<slot>` content as a marker-bounded range, so a slot positions among
static siblings exactly like a control-flow block — by `before` (create) or the claim
cursor (hydrate). `render` appends the parent-supplied `$children`, or the slot's own
fallback when none was passed; it runs once (a slot never toggles), so there is no effect or
re-render — the markers exist only to delimit the range for create insertion and hydrate
claiming.

Create fills the range before the end marker; hydrate adopts the server range in place
(claiming from the parked cursor). Mirrors `when` without the conditional swap.
*/
// @readme plumbing
export function mountSlot(
    parent: Node,
    render: (host: Node) => void,
    before: Node | null = null,
): void {
    const hydration = RENDER.hydration
    openMarker(parent, '[', before)
    if (hydration !== undefined) {
        scope(() => render(parent)) // content claims the SSR range in place
        openMarker(parent, ']')
    } else {
        const end = openMarker(parent, ']', before)
        fillBefore(end, render)
    }
}
