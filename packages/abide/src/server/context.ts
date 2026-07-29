// Accessor for the per-request bag — a free-form store for middleware/handler state. Distinct
// from the M1 cache context (that one backs memo caching; this one is user scratch space).
// Throws outside a request scope.

import { scopeField } from './internal/scopeField.ts'

export function context(): Record<string, unknown> {
    return scopeField('context', 'bag')
}
