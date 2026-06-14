import { applyResolvedView, isCurrentView, syncUrl } from './page.svelte.ts'
import type { NavigateOptions } from './types/NavigateOptions.ts'

// Writes the navigation into history — replace swaps the current entry, else push.
function writeHistory(replace: boolean, fullTarget: string): void {
    if (replace) {
        window.history.replaceState(undefined, '', fullTarget)
    } else {
        window.history.pushState(undefined, '', fullTarget)
    }
}

/*
SPA navigation entrypoint. When only `search` or `hash` changes (same
pathname) the JSON resolve fetch + loadView are skipped — history is written
and `page.url` reassigned so $derived consumers re-run without a network
round-trip or page remount. On a pathname change the target view is resolved
*before* history is touched: a non-SPA target (raw JSON endpoint, unknown
route, failed import) hard-navigates cleanly via `location.href`, because a
pushed entry whose URL no longer matches its in-memory document corrupts
back/forward (Safari restores the stale document under the new URL).
*/
// @readme navigate
export async function navigate(href: string, options: NavigateOptions = {}): Promise<void> {
    const { replace = false, scroll = true } = options
    const target = new URL(href, window.location.href)
    if (target.origin !== window.location.origin) {
        window.location.href = href
        return
    }
    const fullTarget = `${target.pathname}${target.search}${target.hash}`
    if (isCurrentView(target.pathname)) {
        writeHistory(replace, fullTarget)
        syncUrl()
        return
    }
    const applied = await applyResolvedView(fullTarget, () => writeHistory(replace, fullTarget))
    if (applied && scroll && !replace) {
        window.scrollTo(0, 0)
    }
}
