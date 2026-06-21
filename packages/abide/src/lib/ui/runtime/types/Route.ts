/* A routable page/layout. Callable to mount directly into a host (the direct-mount
   API), but the router instead uses `build` — the bare client build — to fill the
   layer into its outlet boundary as a marker range (no `<abide-outlet>` wrapper; see
   `fillBoundary`/`outlet`). `hydratable` (false when the page has an `await` block)
   tells the router whether the first paint adopts the SSR DOM in place. */
export type Route = ((host: Element, props?: unknown) => (() => void) | undefined) & {
    build: (host: Node, props?: unknown) => void
    hydratable?: boolean
}
