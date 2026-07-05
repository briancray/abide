import { createScope } from './createScope.ts'
import { CURRENT_SCOPE } from './runtime/CURRENT_SCOPE.ts'
import type { Scope } from './types/Scope.ts'

/*
Resolves the current lexical scope — established per lexical level by the compiler,
so it reads "where you are" with no handle. Outside any scope (boot, a script) it
mints a detached root once and reuses it. Now the INTERNAL lowering host: the author
reactive surface is the imported `state`/`state.linked`/`state.computed`/`effect`; the
compiler lowers each onto this scope (`$$scope().derive`/`.linked`/`.effect`), and
`state.share`/`.shared` route through it. Still published so generated code and the
type-checking shadow can import it; not part of the author-facing surface.
*/
// @documentation plumbing
export function scope(): Scope {
    if (!CURRENT_SCOPE.current) {
        CURRENT_SCOPE.current = createScope()
    }
    return CURRENT_SCOPE.current
}
