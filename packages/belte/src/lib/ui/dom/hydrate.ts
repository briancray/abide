import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'

/*
Adopts existing server-rendered DOM instead of rebuilding it. Runs `build(host)`
with a claim cursor active, so the dom helpers (openChild/appendText/appendStatic)
take the existing nodes rather than creating new ones — attaching event listeners
and reactive effects to the server's markup in place (no re-render, preserved
focus/scroll). Returns a disposer.

Adopts static structure (elements + text + bindings), `if`/`else`, keyed `each`,
and `switch` in place. `await` blocks and child components aren't adopted yet
(await interacts with stream-swap; child components need their own hydrate entry)
— components using those should `mount` for now.
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
