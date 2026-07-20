// Accessor for the per-request bag — a free-form store for middleware/handler state. Distinct
// from the M1 cache context (that one backs cell caching; this one is user scratch space).
// Throws outside a request scope.

import { currentScope } from './internal/scope.ts'

export function context(): Record<string, unknown> {
    const scope = currentScope()
    if (scope === undefined) {
        throw new Error('context(): no active request scope — call it inside a request handler.')
    }
    return scope.bag
}
