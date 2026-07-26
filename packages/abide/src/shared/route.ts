// Isomorphic accessor for the current route info. On the SERVER it reads the active request's reactive
// context (`runInScope` copies the router's `RouteInfo` onto it). On the CLIENT (no request) it reads
// the reactive client-route holder set by bootstrap/soft-nav — reading it inside a binding subscribes,
// so route().params/name/url changes re-render dependents. Throws only when neither source is
// available (called outside a request and before client bootstrap).
//
// Reads the CONTEXT, not the request scope (ADR 0026), so `shared/` names nothing in `server/`.
// `peekReactiveScope` rather than `reactiveScope` because the no-context case is a legitimate answer here and
// must not install the process-global default scope on the way to throwing.

import { peekReactiveScope } from './internal/reactiveScope.ts'
import { readClientRoute } from './internal/routeHolder.ts'
import type { RouteInfo } from './internal/routeInfo.ts'

export function route(): RouteInfo {
    const active = peekReactiveScope()?.route
    if (active !== undefined) return active
    const client = readClientRoute()
    if (client !== undefined) return client
    throw new Error(
        'route(): no active request scope — call it inside a request handler or after client bootstrap.',
    )
}
