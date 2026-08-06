// Client substrate: a TemplateResult becomes DOM, and slots become effects.
//
// Three functions, because that is the whole public surface of a renderer: `mount` puts a view on
// the screen and keeps it live, `hydrate` does the same over markup the server already wrote, and
// `keyed` tells a list which row is which. Everything else — the parse-once cache, the child/list
// parts, the per-slot effects — is in `internal/` and is reached only through these.

import type { TemplateResult } from '$shared/html.ts'
import { scope, watch } from '$shared/reactive.ts'
import { installHistory } from './internal/history.ts'
import { ChildPart } from './internal/parts.ts'

// Routing's client edge, handed to `$shared` here rather than found there: importing this entry point
// is what says there is a document, exactly as calling `serve` says there is a request. At import and
// not on the first `mount`, because an app navigates to where it already is before it renders.
installHistory()

export interface Mounted {
    dispose(): void
}

// The one body behind both entry points. `adopt` is the only thing that differs: null builds the
// nodes, a node list claims the ones already there.
function attach(container: Element, view: () => TemplateResult, existing: ChildNode[] | null): Mounted {
    const held = scope(() => {
        const anchor = document.createComment('$root')
        container.append(anchor)
        const part = new ChildPart(anchor)
        if (existing !== null) part.adopt(existing, null)
        watch(() => part.set(view()))
        return part
    })
    return {
        dispose(): void {
            held.dispose()
            held.value.dispose()
            container.replaceChildren()
        },
    }
}

// Render into a container and keep it live. Everything created under here disposes together.
export function mount(container: Element, view: () => TemplateResult): Mounted {
    return attach(container, view, null)
}

/**
 * The same, over markup the server already wrote. `mount` with a different way of getting its nodes:
 * every part adopts the range the server's markers gave it instead of building one, and then runs the
 * ordinary first update — which writes nothing, because every binding compares before it writes.
 *
 * The markup must come from a render with `{ hydratable: true }`, and hydration must wait until the
 * whole document is there: `renderDocument` streams its out-of-order patches before `</body>`, so
 * `DOMContentLoaded` is the earliest safe moment.
 *
 * A divergence is not fatal. The part that cannot claim its range warns and builds instead, so a
 * mismatch costs that subtree's DOM work rather than the page.
 */
export function hydrate(container: Element, view: () => TemplateResult): Mounted {
    // Snapshotted BEFORE the anchor is appended, so the anchor is not one of the nodes to claim.
    return attach(container, view, Array.from(container.childNodes) as ChildNode[])
}

// `keyed` is isomorphic — a key is data, not a renderer concept — so it is re-exported here
// rather than owned here, and the same call works in a template that is server-rendered.
export { keyed } from '$shared/html.ts'
