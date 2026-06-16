import type { SsrRender } from './SsrRender.ts'

/*
A compiled abide-ui component's default export: the client mounter, plus `render`
for SSR and the hydration hooks. This is the shape `compileModule` emits and the
page/route registries carry — the abide-ui counterpart to a Svelte `Component`.
*/
export type UiComponent = ((host: Element, props?: Record<string, string>) => () => void) & {
    render: (props?: Record<string, string>) => SsrRender
    hydrate?: (host: Element, props?: Record<string, string>) => () => void
    hydratable?: boolean
}
