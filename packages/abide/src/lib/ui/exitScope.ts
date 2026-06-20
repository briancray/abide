import { CURRENT_SCOPE } from './runtime/CURRENT_SCOPE.ts'
import type { Scope } from './types/Scope.ts'

/* Restores the scope `enterScope` saved, closing an SSR render's scope. */
// @documentation plumbing
export function exitScope(previous: Scope | undefined): void {
    CURRENT_SCOPE.current = previous
}
