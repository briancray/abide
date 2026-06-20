import { activePage } from './activePage.ts'
import type { PageSnapshot } from './types/PageSnapshot.ts'

/*
The reactive page proxy: the matched route, decoded params, browser-space URL,
and `navigating` flag for the active page. Isomorphic — the server resolver reads
the per-request store, the client resolver the router-updated snapshot — so
`{page.url.pathname}` and `page.params.id` work the same during SSR and after
hydration. Read inside a abide-ui effect/derived, a field re-runs its reader when
navigation updates the snapshot (the client resolver reads a abide-ui signal).

`url` is browser-space on both sides: under a mount base the pathname carries the
prefix (the server re-applies it to the proxy-stripped request URL), so compare
active state against url() output, e.g. `page.url.pathname.startsWith(url('/x'))`.
*/
// @documentation page
export const page: PageSnapshot = {
    get route(): string {
        return activePage().route
    },
    get params(): Record<string, string> {
        return activePage().params
    },
    get url(): URL {
        return activePage().url
    },
    get navigating(): boolean {
        return activePage().navigating
    },
}
