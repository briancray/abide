import { historyEntries } from './runtime/historyEntries.ts'
import { runtimePath } from './runtime/runtimePath.ts'

/* Navigates to `path`: writes a history entry (when available) and updates the
   reactive route, which re-mounts the matching page via `router`. `replace` swaps
   the current entry instead of pushing — used when honouring a server redirect, so
   the blocked URL isn't left behind in history. Each entry carries a monotonic
   `abideEntry` id so the router can bucket/restore its scroll offset across the page
   teardown the rebuild does. A push leaves the current entry behind — its scroll is
   bucketed so back restores it — and mints a fresh id. A replace destroys the current
   entry and lands fresh content (a redirect), so its saved scroll no longer applies:
   the bucket is discarded and the id kept, so the new page restores to top/anchor. */
// @documentation navigate
export function navigate(path: string, replace = false): void {
    if (typeof history !== 'undefined') {
        if (replace) {
            historyEntries.discard()
            history.replaceState({ abideEntry: historyEntries.current }, '', path)
        } else {
            historyEntries.save()
            history.pushState({ abideEntry: historyEntries.next() }, '', path)
        }
    }
    runtimePath.value = path
}
