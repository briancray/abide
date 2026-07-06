import { hydratingSlot } from '../../shared/hydratingSlot.ts'
import { wakeHydrationPeeks } from '../../shared/wakeHydrationPeeks.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import { scopeLabel } from './scopeLabel.ts'
import { withScope } from './withScope.ts'

/*
Adopts existing server-rendered DOM instead of rebuilding it. Runs `build(host)`
with a claim cursor active, so the dom helpers (skeleton/appendText/appendStatic)
take the existing nodes rather than creating new ones — attaching event listeners
and reactive effects to the server's markup in place (no re-render, preserved
focus/scroll). Returns a disposer.

Adopts the server DOM in place across the framework: static structure (elements
+ text + bindings), `if`/`else`, keyed `each`, `switch`, `try`, and child
components (with slots) — they hydrate automatically because a child's marker range
is claimed while hydration is still active (see `mountRange`). `await` adopts too when it can resume
the value (a streamed `RESUME[id]` or a warm-sync/cache read); only a genuinely-
pending `await` — no resume, not cache-warm — discards its boundary and builds
the pending branch fresh (see `awaitBlock`).
*/
// @documentation plumbing
export function hydrate(
    host: Element,
    build: (host: Element, props: unknown) => void,
    props?: unknown,
): () => void {
    const previous = RENDER.hydration
    const previousHydrating = hydratingSlot.active
    RENDER.hydration = { next: new Map() }
    hydratingSlot.active = true
    try {
        /* Same shared mount core as `mount` (see `withScope`) — a hydrated component owns a
           scope too, adopting the model its build adopts — run with the claim cursor active. */
        const { lexical } = withScope(scopeLabel(host), () => scope(() => build(host, props)))
        return () => lexical.dispose()
    } finally {
        RENDER.hydration = previous
        hydratingSlot.active = previousHydrating
        /* Wake the peeks this pass withheld — only when unwinding the OUTERMOST pass, so a
           nested child hydrate doesn't fire it early (save/restore, not a bare reset). */
        if (!previousHydrating) {
            wakeHydrationPeeks()
        }
    }
}
