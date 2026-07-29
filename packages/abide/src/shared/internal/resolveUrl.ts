// Shared URL resolution for `url()` and `navigate()`: fill a page path's dynamic segments from
// `params`, then append `query` as a query string. Isomorphic — no DOM. Segment forms mirror the
// file-based router (matchRoute.ts):
//   - `[name]`    required — filled from `params[name]` (a missing param throws so a broken link fails
//                            loudly at call time rather than emitting a malformed URL)
//   - `[[name]]`  optional — filled when `params[name]` is present, otherwise the segment is DROPPED
//   - `[...name]` rest     — filled from a `/`-joined string (each part encoded); an empty string drops it
// The type helpers derive a path literal's params so callers pass a correctly-shaped params object
// (and only when the path declares one).
//
// The bracket forms are the WHOLE grammar. A `/:name` colon segment is a LITERAL, exactly as
// `matchRoute.classify` reads it. This file used to fill it as a required param, which no other layer
// agreed with: `PathParamsArg`/`HasParams` never derived a key from it, so the types already declared
// the path param-less, and the router already matched the segment literally. The result was that
// `url('/users/:id', { id: 7 })` produced `/users/7` — a link no route could ever match.

import { classifyRouteSegment, LITERAL, OPTIONAL, REST } from './routeSegmentKind.ts'

export type UrlQueryValue = string | number | boolean | null | undefined
export type UrlQuery = Record<string, UrlQueryValue | UrlQueryValue[]>

// The params object a path literal requires, derived by peeling its bracket segments left to right.
// Each `[name]` and `[...name]` → a required `string | number` key; each `[[name]]` → an optional key.
// A path with no bracket segments yields `{}`.
export type PathParamsArg<P extends string> = P extends `${string}[${infer After}`
    ? After extends `[${infer Name}]]${infer Rest}`
        ? { [K in Name]?: string | number } & PathParamsArg<Rest>
        : After extends `...${infer Name}]${infer Rest}`
          ? { [K in Name]: string | number } & PathParamsArg<Rest>
          : After extends `${infer Name}]${infer Rest}`
            ? { [K in Name]: string | number } & PathParamsArg<Rest>
            : // biome-ignore lint/complexity/noBannedTypes: the empty-object tail of the param intersection
              {}
    : // biome-ignore lint/complexity/noBannedTypes: a path with no bracket segments declares no params
      {}

// Whether a path declares any bracket segment — the split between the (path, params, query) and
// (path, query) call shapes. Matches `[name]`, `[[name]]` and `[...name]`.
type HasParams<P extends string> = P extends `${string}[${string}]${string}` ? true : false

// Trailing args for `url(path, …)`: a params object when the path declares bracket segments, else just
// an optional query. When every declared param is optional (`{} extends PathParamsArg<P>`) the params
// object itself becomes optional so an all-optional path needs no params argument.
export type UrlArgs<P extends string> =
    HasParams<P> extends true
        ? // biome-ignore lint/complexity/noBannedTypes: `{} extends` tests whether every param key is optional
          {} extends PathParamsArg<P>
            ? [params?: PathParamsArg<P>, query?: UrlQuery]
            : [params: PathParamsArg<P>, query?: UrlQuery]
        : [query?: UrlQuery]

// Whether a path declares any dynamic segment — the runtime split between the (path, params, query)
// and (path, query) call shapes. Bracket forms only, matching `HasParams` above and the router.
export function hasDynamicSegments(path: string): boolean {
    return /\[[^\]]*\]/.test(path)
}

// Fill one path segment from params. Returns the resolved text, an array of resolved segments (a rest
// expansion), or undefined when the segment is dropped (an absent optional / empty rest).
function fillSegment(
    segment: string,
    params: Record<string, string | number> | undefined,
    path: string,
): string | string[] | undefined {
    // The bracket grammar is `routeSegmentKind`, shared with `matchRoute`. These two are INVERSES —
    // one matches a pathname against a pattern, the other fills the pattern back into an href — so a
    // private copy here is a copy that can disagree with the matcher, and the failure mode is a link no
    // route can match (which is exactly what happened once; see the note at the head of this file).
    const classified = classifyRouteSegment(segment)
    if (classified.kind === LITERAL) return segment
    const name = classified.name
    const optional = classified.kind === OPTIONAL
    const rest = classified.kind === REST
    const value = params?.[name]
    if (rest) {
        if (value === undefined) {
            throw new Error(`url(): missing param "${name}" for path "${path}".`)
        }
        // A `/`-joined string expands into one encoded segment per part; an empty string drops it.
        return String(value)
            .split('/')
            .filter((part) => part.length > 0)
            .map((part) => encodeURIComponent(part))
    }
    if (value === undefined) {
        if (optional) return undefined
        throw new Error(`url(): missing param "${name}" for path "${path}".`)
    }
    return encodeURIComponent(String(value))
}

export function resolveUrl(
    path: string,
    params: Record<string, string | number> | undefined,
    query: UrlQuery | undefined,
): string {
    const parts: string[] = []
    for (const segment of path.split('/')) {
        if (segment === '') {
            parts.push(segment) // preserve a leading/trailing slash boundary
            continue
        }
        const filled = fillSegment(segment, params, path)
        if (filled === undefined) continue
        if (Array.isArray(filled)) {
            for (const item of filled) parts.push(item)
            continue
        }
        parts.push(filled)
    }
    // All segments dropped (an all-optional path with no params) collapses to the root.
    const resolved = parts.length === 0 ? '/' : parts.join('/')
    return appendQuery(resolved === '' ? '/' : resolved, query)
}

// Append query values, preserving any existing `?…` and keeping a trailing `#hash` last.
function appendQuery(resolved: string, query: UrlQuery | undefined): string {
    const search = buildSearch(query)
    if (search === '') return resolved
    const hashIndex = resolved.indexOf('#')
    const base = hashIndex === -1 ? resolved : resolved.slice(0, hashIndex)
    const hash = hashIndex === -1 ? '' : resolved.slice(hashIndex)
    const separator = base.includes('?') ? '&' : '?'
    return `${base}${separator}${search}${hash}`
}

function buildSearch(query: UrlQuery | undefined): string {
    if (query === undefined) return ''
    const search = new URLSearchParams()
    for (const key in query) {
        const value = query[key]
        if (value === undefined || value === null) continue
        if (Array.isArray(value)) {
            for (const item of value) {
                if (item === undefined || item === null) continue
                search.append(key, String(item))
            }
        } else {
            search.append(key, String(value))
        }
    }
    return search.toString()
}
