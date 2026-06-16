import { enterRenderPass } from '../runtime/enterRenderPass.ts'
import { exitRenderPass } from '../runtime/exitRenderPass.ts'
import { scope } from '../runtime/scope.ts'

/*
Mounts a component into `host`: runs `build(host)` under an ownership scope so
every binding it creates is collected, and returns a disposer that stops all
reactivity and clears the host. `build` appends its nodes to `host` (via the dom
bindings below). This is the runtime entry the compiler's component output calls.

Brackets a render pass so the outermost mount resets the block-id counter and an
inlined child component's mount continues it — keeping await/try ids aligned with
the SSR stream (see `enterRenderPass`).
*/
// @readme plumbing
export function mount(host: Element, build: (host: Element) => void): () => void {
    enterRenderPass()
    const stop = scope(() => {
        try {
            build(host)
        } finally {
            exitRenderPass()
        }
    })
    return () => {
        stop()
        host.textContent = ''
    }
}
