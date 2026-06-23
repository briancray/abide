import { historyEntries } from './runtime/historyEntries.ts'
import { runtimePath } from './runtime/runtimePath.ts'

/* Options for `navigate`. `replace` swaps the current history entry instead of pushing.
   `keepScroll` carries the live scroll offset onto the destination so it isn't reset. */
export type NavigateOptions = {
    replace?: boolean
    keepScroll?: boolean
}

/* Navigates to `path`: writes a history entry (when available) and updates the
   reactive route, which re-mounts the matching page via `router`. `replace` swaps
   the current entry instead of pushing — used when honouring a server redirect, so
   the blocked URL isn't left behind in history. Each entry carries a monotonic
   `abideEntry` id so the router can bucket/restore its scroll offset across the page
   teardown the rebuild does. A push leaves the current entry behind — its scroll is
   bucketed so back restores it — and mints a fresh id. A replace destroys the current
   entry and lands fresh content (a redirect), so its saved scroll no longer applies:
   the bucket is discarded and the id kept, so the new page restores to top/anchor.
   `keepScroll` opts the destination out of that reset — for an in-page URL swap (e.g.
   selecting another episode on the same detail page) where a top jump is jarring: the
   live offset is bucketed under the destination entry id, so the post-rebuild `restore`
   reapplies it instead of scrolling to top. */
// @documentation navigate
export function navigate(
    path: string,
    { replace = false, keepScroll = false }: NavigateOptions = {},
): void {
    if (typeof history !== 'undefined') {
        if (replace) {
            /* keepScroll buckets the live offset under the (unchanged) entry id so
               restore reapplies it; otherwise the superseded content drops its bucket. */
            if (keepScroll) {
                historyEntries.save()
            } else {
                historyEntries.discard()
            }
            history.replaceState({ abideEntry: historyEntries.current }, '', path)
        } else {
            historyEntries.save()
            history.pushState({ abideEntry: historyEntries.next() }, '', path)
            /* Re-bucket the same offset under the freshly minted id so the pushed entry
               restores to it rather than to top. */
            if (keepScroll) {
                historyEntries.save()
            }
        }
    }
    runtimePath.value = path
}
