// ROUTE INFO — the shape `route()` returns, on both sides (ADR 0026).
//
// Lives in `shared/internal/` because it is web-standard all the way down (a `URL`, a name, params)
// and BOTH sides produce one: the router builds it per request, the browser's soft-nav holder
// (`routeHolder.ts`) replaces it per navigation. It used to be declared on `RequestScope`, which
// forced `shared/route.ts` to import up out of the bottom layer for a type carrying nothing
// server-specific.

// What `route().kind` can say — every member of which the framework actually produces:
//   • `'nav'` — a page navigation (first load or soft nav); `name` is the route pattern.
//   • `'rpc'` — an RPC call, streaming or not; `name` is the rpc name.
//   • `'socket-connect'` — the WebSocket mux UPGRADE, where the global middleware chain runs
//     (`auth.md` §13.4). `name` is the mux route; no specific socket is named yet, because a
//     connection carries many. Per-socket/per-room middleware is a later refinement, at subscribe.
//   • `'socket-subscribe'` / `'socket-publish'` — the socket HTTP face; `name` is the socket name.
//
// It used to declare one more, `'stream'`, which nothing ever set — so `if (route().kind === 'stream')`
// type-checked, passed review, and could never run. Removed, because a union member the runtime never
// delivers is a promise the type is not keeping. A streaming rpc reports `'rpc'`, which is the honest
// answer: the same handler, the same name, the same authorization. (Note that `kind: 'stream'` IS
// produced in this codebase on a DIFFERENT type — `ResponseSource`, from `jsonl()`/`sse()`. Same field
// name, same literal, unrelated meaning, one grep away from being conflated.)
//
// `'socket-connect'` was in the same state and is NOT any more: the upgrade used to return before
// `routeInfo` was reached and built no scope, so nothing could report it — and the chain that
// `auth.md` promised runs there did not run either. It now does, and this kind is what a middleware
// sees when it does.
export type RouteKind = 'nav' | 'rpc' | 'socket-connect' | 'socket-subscribe' | 'socket-publish'

export interface RouteInfo {
    kind: RouteKind
    name: string
    params: Record<string, unknown>
    url: URL
    navigating: boolean
}
