// Accessor for the current request's cookies. Throws outside a request scope.

import { scopeField } from './internal/scopeField.ts'

export function cookies(): Bun.CookieMap {
    return scopeField('cookies', 'cookies')
}
