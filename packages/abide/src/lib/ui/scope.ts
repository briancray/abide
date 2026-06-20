import { createScope } from './createScope.ts'
import { CURRENT_SCOPE } from './runtime/CURRENT_SCOPE.ts'
import type { Scope } from './types/Scope.ts'

/*
Resolves a lexical scope. `scope()` returns the current one — established per
lexical level by the compiler, so it reads "where you are" with no handle. Outside
any scope (boot, a script) it mints a detached root once and reuses it. `scope('/')`
returns the root of the current tree (the app-global scope). The returned value is
passable: hand it to a child or a helper and it can read/extend/undo that scope.
*/
// @documentation reactive-state
export function scope(address?: string): Scope {
    const current = CURRENT_SCOPE.current ?? (CURRENT_SCOPE.current = createScope())
    return address === '/' ? current.root() : current
}
