/*
What a component is invoked with. A top-level page/layout is called by the router
(client) and `renderChain` (SSR) with its route params as reactive thunks, shaped
identically to the thunk map `mountChild` passes a nested child — so `props()` reads
(`$props[name]?.()`) work uniformly on both. `children` is an ordinary prop thunk like
any other: on a component it returns the parent's `Snippet`; on a layout with a child
layer below it, the router/SSR set it to `() => CHILD_PRESENT` (a presence sentinel, not
a slot builder) so `{#if children}` reads truthy.
*/
export type UiProps = Record<string, () => unknown> & {
    children?: () => unknown
}
