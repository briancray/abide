import { createScope } from '../createScope.ts'
import { CURRENT_SCOPE } from '../runtime/CURRENT_SCOPE.ts'
import { enterRenderPass } from '../runtime/enterRenderPass.ts'
import { exitRenderPass } from '../runtime/exitRenderPass.ts'
import { scope } from '../runtime/scope.ts'
import { scopeLabel } from './scopeLabel.ts'

/*
Mounts a component into `host`: runs `build(host)` under an ownership scope so
every binding it creates is collected, and returns a disposer that stops all
reactivity and clears the host. `build` appends its nodes to `host` (via the dom
bindings below). This is the runtime entry the compiler's component output calls.

Brackets a render pass so the outermost mount resets the block-id counter and an
inlined child component's mount continues it — keeping await/try ids aligned with
the SSR stream (see `enterRenderPass`).
*/
// @documentation plumbing
export function mount(host: Element, build: (host: Element) => void): () => void {
    enterRenderPass()
    /* Establish this component's lexical scope, nested under the enclosing one, in
       `awaiting` mode so it adopts the model doc the build's first `doc()` creates.
       `scope()` and its capabilities resolve to it during the build; the previous
       scope is restored after (synchronous build, so the restore is exact). */
    const parentScope = CURRENT_SCOPE.current
    const lexical = createScope({}, parentScope, true, scopeLabel(host))
    CURRENT_SCOPE.current = lexical
    const stop = scope(() => {
        try {
            build(host)
        } finally {
            exitRenderPass()
            CURRENT_SCOPE.current = parentScope
        }
    })
    return () => {
        stop()
        lexical.dispose()
        host.textContent = ''
    }
}
