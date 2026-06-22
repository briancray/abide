import { OUTLET_CLOSE, OUTLET_OPEN } from './runtime/OUTLET_MARKER.ts'
import type { RenderContext } from './runtime/types/RenderContext.ts'
import type { SsrRender } from './runtime/types/SsrRender.ts'
import type { UiComponent } from './runtime/types/UiComponent.ts'

const OPEN = `<!--${OUTLET_OPEN}-->`
const CLOSE = `<!--${OUTLET_CLOSE}-->`
/* A layout's empty outlet boundary, before the child layer is folded in. */
const OUTLET_PLACEHOLDER = `${OPEN}${CLOSE}`

/*
Server-renders a route's layout chain wrapped around its page into one SsrRender.
`views` is ordered outermost layout → … → page. The whole chain shares ONE request-local
block-id counter (`$ctx`): each `render()` is awaited sequentially (render is async), so
every `await`/`try` block across all layers draws a unique id from the shared counter — in
the same layer-sequential order the client hydrates them, keeping the streamed fragments
and the resume manifest aligned. Sequential (not `Promise.all`) so the counter advances
deterministically and the reactive scopes never interleave.

The html nests inner-to-outer: each parent layout's empty outlet boundary
(`<!--abide:outlet--><!--/abide:outlet-->`) is filled with the accumulated child html —
no `<abide-outlet>` ELEMENT, so the filled child lays out as a direct child of the
slot's parent (the router mounts/hydrates it as a marker range, see `outlet`/`fillBoundary`).
The whole chain is wrapped in a ROOT boundary the router fills into `#app`. Awaits
concatenate (already uniquely numbered); state and inline blocking `resume` values merge.
A layout missing its `<slot/>` is a build error surfaced here.
*/
export async function renderChain(
    views: UiComponent[],
    params: Record<string, string>,
): Promise<SsrRender> {
    const ctx: RenderContext = { next: 0 }
    const renders: SsrRender[] = []
    for (const view of views) {
        renders.push(await view.render(params, ctx))
    }
    let html = renders[renders.length - 1]?.html ?? ''
    for (let index = renders.length - 2; index >= 0; index -= 1) {
        const parent = renders[index] as SsrRender
        /* EXACTLY one outlet, not at-least-one: `.replace` fills only the first, and
           the client router fills the LAST `outlet()` call's boundary (`PENDING_OUTLET`),
           so a second outlet would mount the SSR child and the hydrated child into
           DIFFERENT slots — a silent desync. Throw at build instead. */
        if (parent.html.split(OUTLET_PLACEHOLDER).length - 1 !== 1) {
            throw new Error('[abide] a layout.abide must contain exactly one <slot/> outlet')
        }
        /* Fold the child between the outlet markers (function replacement so `$&`/`$\``
           in the child html insert literally). */
        const child = html
        html = parent.html.replace(OUTLET_PLACEHOLDER, () => OPEN + child + CLOSE)
    }
    return {
        /* Root boundary — the router fills `#app` by claiming/creating this same
           boundary and mounting the outermost layer (or lone page) into it. */
        html: OPEN + html + CLOSE,
        awaits: renders.flatMap((render) => render.awaits),
        state: Object.assign({}, ...renders.map((render) => render.state)),
        resume: Object.assign({}, ...renders.map((render) => render.resume)),
    }
}
