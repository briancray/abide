/*
What a component is invoked with. Two real shapes flow through the one parameter.
A top-level page/layout is called by the router (client) and `renderChain` (SSR)
with its decoded route params — a plain string map. A nested child is called by
the compiler-emitted `mountChild` with a map of reactive thunks (each authored
prop, read in the body as `$props[name]?.()`) plus optional slot builders:
`$children` for default-slot markup and `$slots[name]` for named slots, each
mounting into the host element it is handed.
*/
export type UiProps =
    | Record<string, string>
    | (Record<string, () => unknown> & {
          $children?: (host: Element) => void
          $slots?: Record<string, (host: Element) => void>
      })
