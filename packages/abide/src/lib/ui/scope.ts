import { createScope } from './createScope.ts'
import { CURRENT_SCOPE } from './runtime/CURRENT_SCOPE.ts'
import type { Scope } from './types/Scope.ts'

/*
Resolves the current lexical scope — established per lexical level by the compiler,
so it reads "where you are" with no handle. Outside any scope (boot, a script) it
mints a detached root once and reuses it. The returned value is passable: hand it to
a child or a helper and it can read/extend/undo that scope (walk up via `.root()`).
*/
// @documentation reactive-state
export function scope(): Scope {
    if (!CURRENT_SCOPE.current) {
        CURRENT_SCOPE.current = createScope()
    }
    return CURRENT_SCOPE.current
}
