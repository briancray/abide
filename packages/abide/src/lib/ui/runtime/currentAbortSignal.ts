import { cacheManagedSlot } from '../../shared/cacheManagedSlot.ts'
import { REACTIVE_CONTEXT } from './REACTIVE_CONTEXT.ts'
import { reactiveAbortState } from './reactiveAbortState.ts'

/*
The AbortSignal bound to the currently-running reactive computation (effect or
computed), its controller created lazily on first use. An RPC invoked inside a
reactive read passes this to fetch, so the request aborts when that computation
re-runs (superseded) or its scope disposes (navigated away). Returns undefined —
leaving the fetch unbound by scope — in two cases: there is no reactive owner to
bind to (an event-handler call), or the call is cache-managed (the cache owns the
shared flight's lifetime; binding it to one reader would abort it for the others).
*/
export function currentAbortSignal(): AbortSignal | undefined {
    const node = REACTIVE_CONTEXT.observer
    if (node === undefined || cacheManagedSlot.active) {
        return undefined
    }
    let controller = reactiveAbortState.controllers.get(node)
    if (controller === undefined) {
        controller = new AbortController()
        reactiveAbortState.controllers.set(node, controller)
        reactiveAbortState.armed = true
    }
    return controller.signal
}
