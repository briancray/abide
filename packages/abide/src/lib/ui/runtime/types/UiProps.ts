/*
What a component is invoked with. A top-level page/layout is called by the router
(client) and `renderChain` (SSR) with its route params as reactive thunks, shaped
identically to the thunk map `mountChild` passes a nested child — so `props()` reads
(`$props[name]?.()`) work uniformly on both. `children` is the slot builder a parent
component passes (carrying the component's `{children()}` content), or `CHILD_PRESENT`
the router/SSR set on a layout that has a child layer below it.
*/
export type UiProps = Record<string, (() => unknown) | ((host: Element) => void)> & {
    children?: (host: Element) => void
}
