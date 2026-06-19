import type { Scope } from '../types/Scope.ts'
import { CURRENT_SCOPE } from './CURRENT_SCOPE.ts'

/*
Runs `fn` with `scope` as the ambient current scope, restoring the previous one
after. Deferred callbacks — an event handler, an effect re-run — fire after the
build that registered them, when `CURRENT_SCOPE` has moved on; wrapping them in
the scope captured at registration is what makes `scope()` inside them resolve the
scope they belong to, not whatever happens to be current when they fire.
*/
export function inScope<T>(scope: Scope | undefined, fn: () => T): T {
    const previous = CURRENT_SCOPE.current
    CURRENT_SCOPE.current = scope
    try {
        return fn()
    } finally {
        CURRENT_SCOPE.current = previous
    }
}
