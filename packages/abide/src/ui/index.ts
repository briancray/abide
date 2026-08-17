// Client substrate: a TemplateResult becomes DOM, and slots become effects.
//
// Two functions, because that is the whole public surface of a renderer: `mount` puts a view on the
// screen and keeps it live, and `hydrate` does the same over markup the server already wrote.
// Everything else — the parse-once cache, the child/list parts, the per-slot effects — is in
// `internal/` and is reached only through these. `keyed` used to be re-exported here as authoring
// vocabulary; it is on `abide/runtime`, because `by` on a `{#for}` is what an author writes.

import type { TemplateResult } from '#shared/html.ts'
import { scope, watch } from '#shared/reactive.ts'
import { outlet } from '#shared/router.ts'
import { installHistory, installMount } from './internal/history.ts'
import { installNavigation } from './internal/navigation.ts'
import { ChildPart } from './internal/parts.ts'

// Routing's client edge, handed to `#shared` here rather than found there: importing this entry point
// is what says there is a document, exactly as calling `serve` says there is a request. At import and
// not on the first `mount`, because an app navigates to where it already is before it renders.
//
// The mount FIRST: it is what every href, every endpoint address and every route match on this side is
// read against, and the sink below is what can start a navigation.
installMount()
installHistory()

export interface Mounted {
    dispose(): void
}

// The one body behind both entry points. `adopt` is the only thing that differs: null builds the
// nodes, a node list claims the ones already there.
function attach(container: Element, view: () => TemplateResult, existing: ChildNode[] | null): Mounted {
    // Nothing else the scope holds can carry this: the sink lives in the ROUTER, which is one lane
    // up from anything a scope owns, so the teardown has to be carried out by hand.
    let uninstallNavigation: (() => void) | null = null
    const held = scope(() => {
        const anchor = document.createComment('$root')
        container.append(anchor)
        const part = new ChildPart(anchor)
        if (existing !== null) part.adopt(existing, null)
        // The part showing the OUTLET is the one a navigation repaints, so this is where the router
        // is handed its way to the screen. Tested by identity rather than by a flag an app would
        // pass: `outlet` is one function, and "this renderer is showing the pages" is exactly what
        // being handed it means.
        if (view === outlet) uninstallNavigation = installNavigation(part)
        watch(() => part.set(view()))
        return part
    })
    return {
        dispose(): void {
            // Before the part goes: the router must stop being handed a part that is about to lose
            // its anchor, or every later `navigate` moves the address bar and paints nothing.
            uninstallNavigation?.()
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
