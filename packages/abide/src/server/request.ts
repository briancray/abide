// Accessor for the current request's raw Request. Throws outside a request scope.

import { currentScope } from './internal/requestScope.ts'

export function request(): Request {
    const scope = currentScope()
    if (scope === undefined) {
        throw new Error('request(): no active request scope — call it inside a request handler.')
    }
    return scope.request
}
