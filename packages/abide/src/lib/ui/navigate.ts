import { parseRouteSegments } from '../shared/parseRouteSegments.ts'
import type { PageRoutes, PathParams } from '../shared/url.ts'
import { url } from '../shared/url.ts'
import { historyEntries } from './runtime/historyEntries.ts'
import { runtimePath } from './runtime/runtimePath.ts'

/* Options for `navigate`. `replace` swaps the current history entry instead of pushing.
   `keepScroll` carries the live scroll offset onto the destination so it isn't reset. */
export type NavigateOptions = {
    replace?: boolean
    keepScroll?: boolean
}

/* Writes an ALREADY-RESOLVED path into history + the reactive route. The router uses this
   for paths it built from a real URL (a clicked link, a popstate, a server redirect) — they
   already carry the mount base, so they must NOT pass through `url()` again. Each entry
   carries a monotonic `abideEntry` id so the router can bucket/restore its scroll offset
   across the page teardown the rebuild does. A push leaves the current entry behind — its
   scroll is bucketed so back restores it — and mints a fresh id. A replace destroys the
   current entry and lands fresh content (a redirect), so its saved scroll no longer applies:
   the bucket is discarded and the id kept, so the new page restores to top/anchor.
   `keepScroll` opts the destination out of that reset — for an in-page URL swap (e.g.
   selecting another episode on the same detail page) where a top jump is jarring: the live
   offset is bucketed under the destination entry id, so the post-rebuild `restore` reapplies
   it instead of scrolling to top. */
export function navigatePath(
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

/* Navigates to a typed in-app path: a route literal with `[name]` segments takes its params
   first (`navigate('/p/[id]', { id })`), then options; a paramless or already-interpolated
   path takes options directly (`navigate('/p', { replace })`). The path is built through
   `url()` — base-correct, params interpolated — exactly as a link href would be, so a
   dynamic `/p/${x}` falls through url()'s paramless branch and is base-prefixed too. */
// @documentation navigate
export function navigate<P extends keyof PageRoutes | (string & {})>(
    path: P,
    ...rest: keyof PathParams<P> extends never
        ? [options?: NavigateOptions]
        : [params: PathParams<P>, options?: NavigateOptions]
): void {
    /* A path declaring `[name]` segments takes params first, options second — mirroring
       url()'s own arg discrimination; otherwise the first arg is options. */
    const hasParams = parseRouteSegments(path).some((segment) => segment.kind === 'param')
    const [first, second] = rest as [unknown, NavigateOptions?]
    /* Params ride url()'s first vararg slot — a path with `[name]` segments interpolates
       them, a paramless one ignores undefined and just base-prefixes. Widen `path` to
       string so url() takes its plain-path overload; its runtime keys off the segments. */
    const params = hasParams
        ? (first as Record<string, string | number | boolean | undefined>)
        : undefined
    const options = (hasParams ? second : (first as NavigateOptions | undefined)) ?? {}
    navigatePath(url(path as string, params), options)
}
