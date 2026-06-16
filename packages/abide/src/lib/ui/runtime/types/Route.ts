/* A routable page: mounts into a host (optionally with props) and may return a
   disposer the router calls when navigating away. A compiled `.abide` default
   export also carries `hydrate` (adopt SSR in place) and `hydratable` (false when
   the page has an `await` block), which the router uses for the initial render. */
export type Route = ((host: Element, props?: unknown) => (() => void) | undefined) & {
    hydrate?: (host: Element, props?: unknown) => () => void
    hydratable?: boolean
}
