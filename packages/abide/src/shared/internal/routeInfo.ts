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
//   • `'socket-subscribe'` / `'socket-publish'` — the socket HTTP face; `name` is the socket name.
//
// It used to declare two more, and NEITHER was ever set — so `if (route().kind === 'stream')`
// type-checked, passed review, and could never run. Removed rather than left documented, because a
// union member the runtime never delivers is a promise the type is not keeping:
//
//   • `'socket-connect'` — the WebSocket upgrade returns before `routeInfo` is reached and builds no
//     request scope at all, so there is nothing for `route()` to report. Producing it is not a
//     one-liner: it would mean giving the upgrade a scope, which is entangled with whether the
//     middleware chain should run there (`docs/spec/auth.md` §13.4 says it does; it does not).
//   • `'stream'` — a streaming rpc reports `'rpc'`, which is the honest answer: the same handler,
//     the same name, the same authorization. Nothing distinguished it. Note that `kind: 'stream'` IS
//     produced in this codebase on a DIFFERENT type (`ResponseSource`, from `jsonl()`/`sse()`) — same
//     field name, same literal, unrelated meaning, and one grep away from being conflated.
export type RouteKind = 'nav' | 'rpc' | 'socket-subscribe' | 'socket-publish'

export interface RouteInfo {
    kind: RouteKind
    name: string
    params: Record<string, unknown>
    url: URL
    navigating: boolean
}
