import { snippetPayload } from '../../shared/snippet.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'

/*
A `{snippet(args)}` interpolation: mount the branded builder's nodes at this
position. The builder builds straight into `parent` — sequential build order
places it correctly among siblings, and its effects join the surrounding
component scope (so they tear down with it). The body's reactive reads update
fine-grained via those effects; an enclosing `each` re-mounts on list changes.

On hydrate the builder runs against the server-rendered nodes between the
`<!--abide:snippet-->`/`<!--/abide:snippet-->` markers — its `openChild`/`appendText`
claim them in place. The cursor is advanced past the open marker before, and past
the close marker after, so the markers themselves are skipped.
*/
// @readme plumbing
export function appendSnippet(parent: Node, read: () => unknown): void {
    const builder = snippetPayload(read())
    if (typeof builder !== 'function') {
        return
    }
    const mount = builder as (host: Node) => void
    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        const open = claimChild(hydration, parent)
        hydration.next.set(parent, open === null ? null : open.nextSibling)
        mount(parent)
        const close = claimChild(hydration, parent)
        hydration.next.set(parent, close === null ? null : close.nextSibling)
        return
    }
    mount(parent)
}
