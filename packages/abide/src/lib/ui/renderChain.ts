import { enterRenderPass } from './runtime/enterRenderPass.ts'
import { exitRenderPass } from './runtime/exitRenderPass.ts'
import { OUTLET_TAG } from './runtime/OUTLET_TAG.ts'
import type { SsrRender } from './runtime/types/SsrRender.ts'
import type { UiComponent } from './runtime/types/UiComponent.ts'

const OUTLET_OPEN = `<${OUTLET_TAG}>`
const OUTLET_CLOSE = `</${OUTLET_TAG}>`
const OUTLET_PLACEHOLDER = `${OUTLET_OPEN}${OUTLET_CLOSE}`

/*
Server-renders a route's layout chain wrapped around its page into one SsrRender.
`views` is ordered outermost layout → … → page. The whole chain renders under a
SINGLE render pass: one outer `enterRenderPass` resets the block-id counter, then
each `render()` runs nested (depth > 0, no reset), so every `await`/`try` block
across all layers draws a unique id from the shared counter — in the same
layer-sequential order the client hydrates them, keeping the streamed fragments and
the resume manifest aligned.

The html nests inner-to-outer: each parent's empty `<abide-outlet>` is filled with
the accumulated child html — the outlet ELEMENT is kept (it stays the live mount
container the client router fills/hydrates the child into, found by tag), so the
SSR DOM and the client-nested DOM match exactly. Awaits concatenate (already
uniquely numbered); state merges. A single component renders unchanged — its own
render with no wrapping. A layout missing its `<slot/>` is a build error surfaced here.
*/
export function renderChain(views: UiComponent[], params: Record<string, string>): SsrRender {
    enterRenderPass()
    try {
        const renders = views.map((view) => view.render(params))
        let html = renders[renders.length - 1]?.html ?? ''
        for (let index = renders.length - 2; index >= 0; index -= 1) {
            const parent = renders[index] as SsrRender
            if (!parent.html.includes(OUTLET_PLACEHOLDER)) {
                throw new Error('[abide] a layout.abide must contain exactly one <slot/> outlet')
            }
            /* Fill the outlet element (keep it), function replacement so `$&`/`$\`` in
               the child html insert literally. */
            const child = html
            html = parent.html.replace(OUTLET_PLACEHOLDER, () => OUTLET_OPEN + child + OUTLET_CLOSE)
        }
        return {
            html,
            awaits: renders.flatMap((render) => render.awaits),
            state: Object.assign({}, ...renders.map((render) => render.state)),
        }
    } finally {
        exitRenderPass()
    }
}
