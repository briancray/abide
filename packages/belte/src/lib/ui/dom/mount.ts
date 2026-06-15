import { scope } from '../runtime/scope.ts'

/*
Mounts a component into `host`: runs `build(host)` under an ownership scope so
every binding it creates is collected, and returns a disposer that stops all
reactivity and clears the host. `build` appends its nodes to `host` (via the dom
bindings below). This is the runtime entry the compiler's component output calls.
*/
// @readme plumbing
export function mount(host: Element, build: (host: Element) => void): () => void {
    const stop = scope(() => build(host))
    return () => {
        stop()
        host.textContent = ''
    }
}
