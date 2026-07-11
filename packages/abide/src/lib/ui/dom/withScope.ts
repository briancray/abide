import { createScope } from '../createScope.ts'
import { CURRENT_SCOPE } from '../runtime/CURRENT_SCOPE.ts'
import { enterRenderPass } from '../runtime/enterRenderPass.ts'
import { exitRenderPass } from '../runtime/exitRenderPass.ts'
import type { Scope } from '../types/Scope.ts'

/*
The shared mount core every page/layout/component build path runs (`mount`, `hydrate`,
`fillRange`, `mountRange`, `fillBoundary`). Establishes the layer's lexical scope nested
under the current one in `awaiting` mode — so it adopts the model doc its first `doc()`
creates — brackets a render pass — so its `await`/`try` block ids draw from the shared
counter in SSR-stream order — runs `build`, then restores the previous scope (synchronous
build, so the restore is exact). `build` returns its reactivity stopper (from `scope` or
`fillBefore`), which the lexical scope ADOPTS (`own`) so the scope has a single teardown:
the caller wraps its own DOM teardown (clear host vs clear range) around one
`lexical.dispose()`, no longer composing a separate `stop()` at every site.
*/
export function withScope(build: () => () => void): { lexical: Scope } {
    const parentScope = CURRENT_SCOPE.current
    const lexical = createScope({}, parentScope, true)
    enterRenderPass()
    CURRENT_SCOPE.current = lexical
    try {
        lexical.own(build())
    } catch (error) {
        /* `build` threw before returning its stopper — e.g. a hydration desync in one of
           several sibling blocks. `own` never ran, so nothing downstream will dispose this
           lexical scope; tear it down here (its child scopes/effects created before the
           throw) before rethrowing, rather than leaking a live, unreachable scope. */
        lexical.dispose()
        throw error
    } finally {
        exitRenderPass()
        CURRENT_SCOPE.current = parentScope
    }
    return { lexical }
}
