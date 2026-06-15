import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'

/*
Adopts existing server-rendered DOM instead of rebuilding it. Runs `build(host)`
with a claim cursor active, so the dom helpers (openChild/appendText/appendStatic)
take the existing nodes rather than creating new ones — attaching event listeners
and reactive effects to the server's markup in place (no re-render, preserved
focus/scroll). Returns a disposer.

Adopts the server DOM in place across the framework: static structure (elements
+ text + bindings), `if`/`else`, keyed `each`, `switch`, and child components
(with slots) — they hydrate automatically because the wrapper is claimed while
hydration is still active. The only block not yet adopted is `await` (it
interacts with the streamed stream-swap); a component using `await` should `mount`.
*/
// @readme plumbing
export function hydrate(host: Element, build: (host: Element) => void): () => void {
    const previous = RENDER.hydration
    RENDER.hydration = { next: new Map() }
    try {
        return scope(() => build(host))
    } finally {
        RENDER.hydration = previous
    }
}
