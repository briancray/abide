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
`fillBefore`); the caller composes its own DOM teardown (clear host vs clear range) around
the returned `stop`/`lexical`, keeping the one scope/render-pass contract in a single place.
*/
export function withScope(
    label: string | undefined,
    build: () => () => void,
): { stop: () => void; lexical: Scope } {
    const parentScope = CURRENT_SCOPE.current
    const lexical = createScope({}, parentScope, true, label)
    enterRenderPass()
    CURRENT_SCOPE.current = lexical
    let stop: () => void = () => undefined
    try {
        stop = build()
    } finally {
        exitRenderPass()
        CURRENT_SCOPE.current = parentScope
    }
    return { stop, lexical }
}
