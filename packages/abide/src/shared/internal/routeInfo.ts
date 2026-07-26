// ROUTE INFO — the shape `route()` returns, on both sides (ADR 0026).
//
// Lives in `shared/internal/` because it is web-standard all the way down (a `URL`, a name, params)
// and BOTH sides produce one: the router builds it per request, the browser's soft-nav holder
// (`routeHolder.ts`) replaces it per navigation. It used to be declared on `RequestScope`, which
// forced `shared/route.ts` to import up out of the bottom layer for a type carrying nothing
// server-specific.

export type RouteKind =
    | 'nav'
    | 'rpc'
    | 'socket-connect'
    | 'socket-subscribe'
    | 'socket-publish'
    | 'stream'

export interface RouteInfo {
    kind: RouteKind
    name: string
    params: Record<string, unknown>
    url: URL
    navigating: boolean
}
