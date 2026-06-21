import { scope } from '../runtime/scope.ts'
import { scopeLabel } from './scopeLabel.ts'
import { withScope } from './withScope.ts'

/*
Mounts a top-level page/layout into `host` (the router's outlet/root element): runs
`build(host, props)` under an ownership scope so every binding it creates is
collected, and returns a disposer that stops all reactivity and clears the host.
`build` appends its nodes to `host` (via the dom bindings below). This is the runtime
entry the router calls; a NESTED child instead mounts as a marker range (see
`mountRange`), so it leaves no wrapper element.

Brackets a render pass so the outermost mount resets the block-id counter and an
inlined child component's mount continues it — keeping await/try ids aligned with
the SSR stream (see `enterRenderPass`).
*/
// @documentation plumbing
export function mount(
    host: Element,
    build: (host: Element, props: unknown) => void,
    props?: unknown,
): () => void {
    /* Establish this component's lexical scope (nested, `awaiting` so it adopts the model
       doc the build's first `doc()` creates) and render pass, run the build under it, and
       restore the previous scope — the shared mount core (see `withScope`). */
    const { stop, lexical } = withScope(scopeLabel(host), () => scope(() => build(host, props)))
    return () => {
        stop()
        lexical.dispose()
        host.textContent = ''
    }
}
