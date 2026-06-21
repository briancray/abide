import { createScope } from '../createScope.ts'
import { CURRENT_SCOPE } from '../runtime/CURRENT_SCOPE.ts'
import { enterRenderPass } from '../runtime/enterRenderPass.ts'
import { exitRenderPass } from '../runtime/exitRenderPass.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import { scopeLabel } from './scopeLabel.ts'

/*
Adopts existing server-rendered DOM instead of rebuilding it. Runs `build(host)`
with a claim cursor active, so the dom helpers (skeleton/appendText/appendStatic)
take the existing nodes rather than creating new ones — attaching event listeners
and reactive effects to the server's markup in place (no re-render, preserved
focus/scroll). Returns a disposer.

Adopts the server DOM in place across the framework: static structure (elements
+ text + bindings), `if`/`else`, keyed `each`, `switch`, `try`, and child
components (with slots) — they hydrate automatically because the wrapper is
claimed while hydration is still active. `await` adopts too when it can resume
the value (a streamed `RESUME[id]` or a warm-sync/cache read); only a genuinely-
pending `await` — no resume, not cache-warm — discards its boundary and builds
the pending branch fresh (see `awaitBlock`).
*/
// @documentation plumbing
export function hydrate(host: Element, build: (host: Element) => void): () => void {
    const previous = RENDER.hydration
    RENDER.hydration = { next: new Map() }
    enterRenderPass()
    /* Same lexical scope establishment as `mount` — a hydrated component owns a scope
       too, adopting the model its build adopts. */
    const parentScope = CURRENT_SCOPE.current
    const lexical = createScope({}, parentScope, true, scopeLabel(host))
    CURRENT_SCOPE.current = lexical
    try {
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
        }
    } finally {
        RENDER.hydration = previous
    }
}
