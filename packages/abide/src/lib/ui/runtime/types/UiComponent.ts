import type { SsrRender } from './SsrRender.ts'
import type { UiProps } from './UiProps.ts'

/*
A compiled abide-ui component's default export: the client mounter, plus `render`
for SSR and the hydration hooks. This is the shape `compileModule` emits and the
page/route registries carry — abide-ui's compiled-component shape.
*/
export type UiComponent = ((host: Element, props?: UiProps) => () => void) & {
    render: (props?: UiProps) => SsrRender
    hydrate?: (host: Element, props?: UiProps) => () => void
    hydratable?: boolean
    /* Stable module id (project-relative source path) stamped by `compileModule`,
       keying the component in the hot-reload registry — see `mountChild`. */
    __abideId?: string
}
