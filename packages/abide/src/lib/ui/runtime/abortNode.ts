import { REQUEST_SUPERSEDED } from './REQUEST_SUPERSEDED.ts'
import { reactiveAbortState } from './reactiveAbortState.ts'
import type { ReactiveNode } from './types/ReactiveNode.ts'

/*
Aborts the RPC(s) a reactive computation left in flight — called when the node
re-runs (the prior run's result is superseded) and when its scope disposes (the
result would land in a torn-down tree). The `armed` gate keeps this a single
boolean check until some reactive RPC has actually bound a controller. The abort
reason is REQUEST_SUPERSEDED so remoteProxy can tell our cancellation from a real
fault and swallow it rather than surface a rejection.
*/
export function abortNode(node: ReactiveNode): void {
    if (!reactiveAbortState.armed) {
        return
    }
    const controller = reactiveAbortState.controllers.get(node)
    if (controller !== undefined) {
        reactiveAbortState.controllers.delete(node)
        controller.abort(REQUEST_SUPERSEDED)
    }
}
