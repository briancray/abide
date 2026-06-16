import { runtimePath } from './runtime/runtimePath.ts'

/* Navigates to `path`: writes a history entry (when available) and updates the
   reactive route, which re-mounts the matching page via `router`. `replace` swaps
   the current entry instead of pushing — used when honouring a server redirect, so
   the blocked URL isn't left behind in history. */
// @readme plumbing
export function navigate(path: string, replace = false): void {
    if (typeof history !== 'undefined') {
        if (replace) {
            history.replaceState({}, '', path)
        } else {
            history.pushState({}, '', path)
        }
    }
    runtimePath.value = path
}
