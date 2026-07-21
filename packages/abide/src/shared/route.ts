// Isomorphic accessor for the current route info. On the SERVER it reads the active request scope.
// On the CLIENT (no request scope) it reads the reactive client-route holder set by bootstrap/soft-nav
// — reading it inside a binding subscribes, so route().params/name/url changes re-render dependents.
// Throws only when neither source is available (called outside a request and before client bootstrap).

import { currentScope, type RouteInfo } from '../server/internal/scope.ts'
import { readClientRoute } from './internal/routeHolder.ts'

export function route(): RouteInfo {
    const scope = currentScope()
    if (scope !== undefined) return scope.route
    const client = readClientRoute()
    if (client !== undefined) return client
    throw new Error(
        'route(): no active request scope — call it inside a request handler or after client bootstrap.',
    )
}
