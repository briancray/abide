// url() — isomorphic in-app href builder. Fills a page path's dynamic segments (`[name]` or `/:name`)
// from `params` and appends `query` as a query string, returning the resolved href. Call shapes:
//   url('/users/[id]', { id }, { tab: 'posts' })   // (path, params, query?)
//   url('/search', { q: 'abide' })                  // (path, query?) — no dynamic segments
//   url(new URL(href), { page: 2 })                 // (url, query?) — already-resolved URL
// `params` is typed from the path literal, so a missing/misnamed segment is a compile error; a missing
// param at runtime throws so a broken link fails loudly rather than emitting a malformed URL. Compose
// with navigate — `navigate(url(...), options)` — to soft-navigate to a built href.

import {
    hasDynamicSegments,
    resolveUrl,
    type UrlArgs,
    type UrlQuery,
} from './internal/resolveUrl.ts'

export function url<P extends string>(path: P, ...args: UrlArgs<P>): string
export function url(path: URL, query?: UrlQuery): string
export function url(path: string | URL, ...args: unknown[]): string {
    if (path instanceof URL) {
        return resolveUrl(path.href, undefined, args[0] as UrlQuery | undefined)
    }
    if (hasDynamicSegments(path)) {
        const [params, query] = args as [Record<string, string | number>, UrlQuery?]
        return resolveUrl(path, params, query)
    }
    const [query] = args as [UrlQuery?]
    return resolveUrl(path, undefined, query)
}
