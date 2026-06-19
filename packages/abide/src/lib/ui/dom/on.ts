import { CURRENT_SCOPE } from '../runtime/CURRENT_SCOPE.ts'
import { inScope } from '../runtime/inScope.ts'
import { OWNER } from '../runtime/OWNER.ts'

/*
Attaches an event listener and registers its removal with the current ownership
scope, so a component's listeners detach when it disposes. This is the runtime
target for an `onclick={…}` binding; the handler body is where the compiler's
lowered patches (`model.replace(...)`) run. The handler is pinned to the scope it
was attached under, so an ambient `scope()` inside it (e.g. `scope().undo()`)
resolves the component, not whatever is current when the event fires.
*/
// @readme plumbing
export function on(element: Element, type: string, handler: EventListener): void {
    const captured = CURRENT_SCOPE.current
    const wrapped: EventListener = (event) => inScope(captured, () => handler(event))
    element.addEventListener(type, wrapped)
    if (OWNER.current !== undefined) {
        OWNER.current.push(() => element.removeEventListener(type, wrapped))
    }
}
