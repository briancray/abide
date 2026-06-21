import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import type { UiProps } from '../runtime/types/UiProps.ts'
import { disposeRange } from './disposeRange.ts'
import { fillRange } from './fillRange.ts'
import { withScope } from './withScope.ts'

/*
Mounts a chain layer (layout or page) into an EXISTING outlet boundary — the markers
a parent layout's `<slot/>` left (`outlet`), or the router's root boundary in `#app`.
The router fills these boundaries instead of mounting into a host element, so the whole
page/layout chain composes through one range model (no `<abide-outlet>` wrapper).

Create: build the layer's content into a fragment that lands just before `close`
(`fillRange`). Hydrate: claim the server content in place — park the parent cursor at
`open.nextSibling` and let the build adopt the existing nodes (the outlet markers
themselves are located via `PENDING_OUTLET`, not claimed through the cursor). The disposer
stops the layer's reactivity and clears the boundary — the router calls it to tear a
divergent layer down before rebuilding the same boundary.
*/
// @documentation plumbing
export function fillBoundary(
    open: Comment,
    close: Comment,
    build: (host: Node, props?: UiProps) => void,
    props: UiProps | undefined,
    label: string | undefined,
): { dispose: () => void } {
    const hydration = RENDER.hydration
    if (hydration === undefined) {
        return fillRange(open, close, build, props, label)
    }
    /* Hydrate: adopt the server content between the markers in place. */
    const parent = open.parentNode as Node
    hydration.next.set(parent, open.nextSibling)
    const scoped = withScope(label, () => scope(() => build(parent, props)))
    return { dispose: disposeRange(scoped, open, close) }
}
