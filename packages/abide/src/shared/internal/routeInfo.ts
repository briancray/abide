// ROUTE INFO — the shape `route()` returns, on both sides (ADR 0026).
//
// Lives in `shared/internal/` because it is web-standard all the way down (a `URL`, a name, params)
// and BOTH sides produce one: the router builds it per request, the browser's soft-nav holder
// (`routeHolder.ts`) replaces it per navigation. It used to be declared on `RequestScope`, which
// forced `shared/route.ts` to import up out of the bottom layer for a type carrying nothing
// server-specific.

// What `route().kind` can say. FOUR of these six are produced; two are declared and unreachable, which
// is worth knowing before you branch on one — `if (route().kind === 'stream')` type-checks and can
// never run.
//
// Produced: `'nav'` (page/soft-nav), `'rpc'`, and — since the socket HTTP face began building a scope
// — `'socket-subscribe'` / `'socket-publish'`.
//
// NOT produced, verified by grep over the whole tree:
//   • `'socket-connect'` — the WebSocket upgrade short-circuits BEFORE `routeInfo` is called and builds
//     no request scope at all, so there is nothing for `route()` to report and no middleware runs (the
//     CSWSH origin check is the only policy an upgrade passes). That is a deliberate pipeline shape,
//     not an oversight; the consequence is just that this member describes a scope that never exists.
//   • `'stream'` — a streaming rpc reports `'rpc'`. Nothing anywhere sets this. Note that `kind:
//     'stream'` IS produced in the codebase, on a DIFFERENT type (`ResponseSource`, from `jsonl()` /
//     `sse()`), and by `compressionShape`; same field name, same literal, unrelated meanings, one grep
//     away from being conflated.
//
// Both are left in place rather than deleted because `RouteKind` is public (`route()` is documented
// API) and narrowing a published union is a breaking change worth deciding deliberately. The choice is
// to produce them or to drop them; documenting them as unreachable is neither, and is only correct as
// long as this comment is true.
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
