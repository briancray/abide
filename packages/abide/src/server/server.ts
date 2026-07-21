// Accessor for the Bun server handling the current request. Throws outside a request scope,
// or when the scope carries no server (e.g. bare in-process test calls).

import { currentScope } from './internal/scope.ts'

export function server(): Bun.Server<undefined> {
    const scope = currentScope()
    if (scope === undefined) {
        throw new Error('server(): no active request scope — call it inside a request handler.')
    }
    if (scope.server === undefined) {
        throw new Error('server(): no Bun server bound to the current request scope.')
    }
    return scope.server
}
