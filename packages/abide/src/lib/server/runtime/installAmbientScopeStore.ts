import { ambientPathBacking } from '../../ui/runtime/ambientPathBacking.ts'
import { ambientScopeBacking } from '../../ui/runtime/ambientScopeBacking.ts'
import { cellBarrierBacking } from '../../ui/runtime/cellBarrierBacking.ts'
import type { Scope } from '../../ui/types/Scope.ts'
import { pathStore } from './pathStore.ts'
import { renderCellBarrierStore } from './renderCellBarrierStore.ts'
import { requestContext } from './requestContext.ts'

/* Ambient scope when no request is in flight (server boot, a standalone render). The path needs
   no such fallback: `pathStore.run` establishes its value with or without a request in flight,
   and `getStore()` fails open to `''` outside any push. */
let outsideRequest: Scope | undefined

/*
Swaps the ambient-scope backing to one keyed off the per-request AsyncLocalStorage store and the
ambient-PATH backing to the dedicated `pathStore.run` (ADR-0033 D1), so `CURRENT_SCOPE.current` and
`CURRENT_PATH.current` isolate per request instead of living in one module global (see CURRENT_SCOPE
/ CURRENT_PATH). SSR is partly async — a render `await`s inline between its `enterScope`/`exitScope`
bracket — and the async context propagates the right value across those awaits, so a resumed render
reads ITS OWN scope/path even while another request renders concurrently. For the path, `run`'s value
is ALSO inherited by the render's own post-await continuation (a mutable slot restored in `finally`
was not), which is the fix ADR-0033 buys. Called once at server boot (createServer), alongside the
request-scope resolver install. The scope backing still falls back to a module variable outside any
request (unchanged behaviour for standalone renders); the path backing needs no such fallback.
*/
export function installAmbientScopeStore(): void {
    ambientScopeBacking.active = {
        get: () => {
            const store = requestContext.getStore()
            return store ? store.currentScope : outsideRequest
        },
        set: (value) => {
            const store = requestContext.getStore()
            if (store) {
                store.currentScope = value
            } else {
                outsideRequest = value
            }
        },
    }
    ambientPathBacking.active = {
        run: (composedPath, build) => pathStore.run(composedPath, build),
        get: () => pathStore.getStore() ?? '',
    }
    /* Per-render async-cell barrier isolation (ADR-0037 Phase 2): a hoisted concurrent child render
       runs under its own pending-cells list via `renderCellBarrierStore.run`, and the barrier
       consumers read it through `cellBarrierBacking.current`. ALS so the fresh list survives the
       child render's own awaits; `undefined` outside any isolated render leaves the page/request
       drain untouched. */
    cellBarrierBacking.active = {
        current: () => renderCellBarrierStore.getStore(),
        run: (list, render) => renderCellBarrierStore.run(list, render),
    }
}
