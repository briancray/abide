import type { RenderContext } from './RenderContext.ts'
import type { SsrRender } from './SsrRender.ts'
import type { UiProps } from './UiProps.ts'

/*
A compiled abide-ui component's default export: the client mounter, plus `render`
for SSR and the hydration hooks. This is the shape `compileModule` emits and the
page/route registries carry — abide-ui's compiled-component shape.
*/
export type UiComponent = ((host: Element, props?: UiProps) => () => void) & {
    /* `ctx` is the request-local block-id counter, threaded so a child's ids share the
       page's depth-first numbering; omitted at the top level (a fresh counter defaults
       in). Returns a Promise when the component contains an inline `await` — a blocking
       `{#await … then}` block, a child-component render, a `<slot>` read, or a
       top-level `await` in the author script; otherwise renders synchronously. Callers `await`
       it either way (awaiting a sync value just returns it). */
    render: (props?: UiProps, ctx?: RenderContext) => SsrRender | Promise<SsrRender>
    hydrate?: (host: Element, props?: UiProps) => () => void
    /* The bare client build (`(host, props) => void`) — appends the component's nodes
       to `host`. A nested child mounts it into a marker range (`mountRange`/`mountChild`)
       instead of the wrapped `mount`, and `hotReplace` re-fills a range with the new
       module's `build` on edit. */
    build: (host: Node, props?: UiProps) => void
    hydratable?: boolean
    /* Stable module id (project-relative source path) stamped by `compileModule`,
       keying the component in the hot-reload registry — see `mountChild`. */
    __abideId?: string
}
