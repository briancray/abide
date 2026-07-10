import { batch } from '../runtime/batch.ts'
import { CURRENT_SCOPE } from '../runtime/CURRENT_SCOPE.ts'
import { inScope } from '../runtime/inScope.ts'
import { OWNER } from '../runtime/OWNER.ts'

/*
Attaches an event listener and registers its removal with the current ownership
scope, so a component's listeners detach when it disposes. This is the runtime
target for an `onclick={…}` binding; the handler body is where the compiler's
lowered patches (`model.replace(...)`) run. The handler is pinned to the scope it
was attached under, so an ambient `scope()` inside it resolves the component, not
whatever is current when the event fires.
*/
// @documentation plumbing
export function on(element: Element, type: string, handler: EventListener): void {
    /* A caller that omits an optional `on*` prop forwards it as undefined, yet the
       compiler still emits this on() call — so skip attaching a non-function rather
       than invoke undefined when the event fires (e.g. input/keydown on a search box,
       which would throw "handler is not a function" on every keystroke). */
    if (typeof handler !== 'function') {
        return
    }
    const captured = CURRENT_SCOPE.current
    /* Coalesce the handler's writes: a handler setting several signals re-runs each
       dependent effect once on batch exit, not once per write (the unbatched default
       flushed eagerly per `trigger`). Stays synchronous — flush runs at handler-end
       before it returns, so the causal stack (dispatch → handler → effects) is intact. */
    const wrapped: EventListener = (event) => inScope(captured, () => batch(() => handler(event)))
    element.addEventListener(type, wrapped)
    if (OWNER.current !== undefined) {
        OWNER.current.push(() => element.removeEventListener(type, wrapped))
    }
}
