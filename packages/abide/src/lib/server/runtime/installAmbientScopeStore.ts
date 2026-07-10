import { ambientPathBacking } from '../../ui/runtime/ambientPathBacking.ts'
import { ambientScopeBacking } from '../../ui/runtime/ambientScopeBacking.ts'
import type { Scope } from '../../ui/types/Scope.ts'
import { requestContext } from './requestContext.ts'

/* Ambient scope/path when no request is in flight (server boot, a standalone render). */
let outsideRequest: Scope | undefined
let outsidePath = ''

/*
Swaps the ambient-scope AND ambient-path backings to ones keyed off the per-request
AsyncLocalStorage store, so `CURRENT_SCOPE.current` / `CURRENT_PATH.current` isolate per
request instead of living in one module global (see CURRENT_SCOPE / CURRENT_PATH). SSR is
partly async — a render `await`s inline between its `enterScope`/`exitScope` bracket — and the
async context propagates the right store across those awaits, so a resumed render reads ITS OWN
scope/path even while another request renders concurrently. Called once at server boot
(createServer), alongside the request-scope resolver install. Reads/writes outside any request
fall back to a module variable (unchanged behaviour for standalone renders).
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
        get: () => {
            const store = requestContext.getStore()
            return (store ? store.currentPath : outsidePath) ?? ''
        },
        set: (value) => {
            const store = requestContext.getStore()
            if (store) {
                store.currentPath = value
            } else {
                outsidePath = value
            }
        },
    }
}
