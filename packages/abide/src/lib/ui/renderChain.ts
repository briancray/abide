import { isolateCellBarrier } from './isolateCellBarrier.ts'
import { CHILD_PRESENT } from './runtime/CHILD_PRESENT.ts'
import { OUTLET_CLOSE, OUTLET_OPEN } from './runtime/OUTLET_MARKER.ts'
import type { RenderContext } from './runtime/types/RenderContext.ts'
import type { SsrRender } from './runtime/types/SsrRender.ts'
import type { UiComponent } from './runtime/types/UiComponent.ts'
import type { UiProps } from './runtime/types/UiProps.ts'
import { withPath } from './runtime/withPath.ts'

const OPEN = `<!--${OUTLET_OPEN}-->`
const CLOSE = `<!--${OUTLET_CLOSE}-->`
/* A layout's empty outlet boundary, before the child layer is folded in. */
const OUTLET_PLACEHOLDER = `${OPEN}${CLOSE}`

/*
Server-renders a route's layout chain wrapped around its page into one SsrRender.
`views` is ordered outermost layout → … → page. The whole chain shares ONE request-local
block-id counter map (`$ctx`): each `await`/`try` block draws a path-namespaced id
(`${render-path}:${n}`, ADR-0037), so ids stay unique across layers by path rather than by
a shared sequential draw — keeping the streamed fragments and the resume manifest aligned
with the client (which composes the same path-keyed ids). The layers render IN PARALLEL
(`Promise.all`, ADR-0038): each roots a distinct route-key path so their block ids never collide,
and each runs under `isolateCellBarrier` so their async-cell barriers don't cross-drain — the html
fold + state/awaits/resume aggregation below run after all settle and are order-independent.

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
    /* Each view's route key (layout directory URL / page route pattern), aligned 1:1 with `views`
       and byte-identical to the client router's `chainKeys`/`pageKey`. Each roots its layer's
       render-path (`withPath`) so a cell's scope id matches the client's for the warm-seed key. */
    keys: string[] = [],
): Promise<SsrRender> {
    const ctx: RenderContext = new Map()
    const renders: SsrRender[] = []
    /* Route params as thunks (static server-side — only shape parity with the client so
       `props()` reads `$props["id"]?.()` resolve). A layout (every view but the last) also
       gets `children` set to `CHILD_PRESENT` so SSR renders `{#if children}` the same way
       the client does, keeping hydration congruent. The sentinel itself must be thunk-wrapped
       (`() => CHILD_PRESENT`) since the destructure lowering CALLS every bag entry — leaving
       it raw would invoke `CHILD_PRESENT` (a function) and read back `undefined`. */
    const paramThunks: UiProps = {}
    for (const key of Object.keys(params)) {
        paramThunks[key] = () => params[key]
    }
    if (views.length > 1) {
        /* ADR-0038: a route WITH layouts renders its layers IN PARALLEL. Block ids are path-keyed
           (ADR-0037) and each layer roots a DISTINCT route-key path, so their id allocations never
           collide even as the async continuations interleave; the fold + state/awaits/resume
           aggregation below run AFTER all settle and are order-independent (keyed merges /
           index-ordered). Each layer runs under `isolateCellBarrier` so its async-cell barrier drains
           its OWN pending list — without it, two layers registering cells concurrently into the one
           request-scoped list would splice-drain each other (the hazard ADR-0037 fixed for sibling
           children). Scope needs no isolation: the shipped parallel child renders tolerate the
           identical per-request CURRENT_SCOPE clobber (all scope-sensitive construction is
           synchronous in each render's prefix). */
        const collected = await Promise.all(
            views.map((view, index) => {
                const hasChild = index < views.length - 1
                const props: UiProps = hasChild
                    ? { ...paramThunks, children: () => CHILD_PRESENT }
                    : paramThunks
                const key = keys[index]
                const run = () => isolateCellBarrier(() => view.render(props, ctx))
                return key === undefined ? run() : withPath(key, run)
            }),
        )
        renders.push(...collected)
    } else if (views.length === 1) {
        /* A lone page (no layouts) — the common case — renders DIRECTLY: no parallelism to gain, and
           no `Promise.all`/`isolateCellBarrier` wrap, so its bare-read/settle timing is byte-identical
           to the pre-ADR-0038 path (a fast in-process read stays pending → streams, rather than
           slipping settled → inline behind an extra microtask). */
        const view = views[0] as UiComponent
        const key = keys[0]
        renders.push(
            key === undefined
                ? await view.render(paramThunks, ctx)
                : await withPath(key, () => view.render(paramThunks, ctx)),
        )
    }
    let html = renders[renders.length - 1]?.html ?? ''
    for (let index = renders.length - 2; index >= 0; index -= 1) {
        const parent = renders[index] as SsrRender
        /* EXACTLY one outlet, not at-least-one: `.replace` fills only the first, and
           the client router fills the LAST `outlet()` call's boundary (`PENDING_OUTLET`),
           so a second outlet would mount the SSR child and the hydrated child into
           DIFFERENT slots — a silent desync. Throw at build instead. */
        if (parent.html.split(OUTLET_PLACEHOLDER).length - 1 !== 1) {
            throw new Error('[abide] a layout.abide must contain exactly one {children()} outlet')
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
