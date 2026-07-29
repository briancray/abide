// Accessor for the current request's raw Request. Throws outside a request scope.

import { scopeField } from './internal/scopeField.ts'

export function request(): Request {
    return scopeField('request', 'request')
}
