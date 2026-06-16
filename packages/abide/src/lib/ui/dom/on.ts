import { OWNER } from '../runtime/OWNER.ts'

/*
Attaches an event listener and registers its removal with the current ownership
scope, so a component's listeners detach when it disposes. This is the runtime
target for an `onclick={…}` binding; the handler body is where the compiler's
lowered patches (`model.replace(...)`) run.
*/
// @readme plumbing
export function on(element: Element, type: string, handler: EventListener): void {
    element.addEventListener(type, handler)
    if (OWNER.current !== undefined) {
        OWNER.current.push(() => element.removeEventListener(type, handler))
    }
}
