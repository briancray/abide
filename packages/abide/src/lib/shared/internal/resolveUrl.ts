// Shared URL resolution for `url()` and `navigate()`: fill a page path's dynamic segments (`[name]`
// or `/:name`) from `params`, then append `query` as a query string. Isomorphic — no DOM. Throws on a
// missing required param so a broken link fails loudly at call time rather than emitting a malformed
// URL. The type helpers derive a path literal's `[name]` params so callers pass a correctly-shaped
// params object (and only when the path declares one).

export type UrlQueryValue = string | number | boolean | null | undefined
export type UrlQuery = Record<string, UrlQueryValue | UrlQueryValue[]>

// The `[name]` params a path literal declares (e.g. `PathParams<'/u/[id]/p/[n]'>` = `'id' | 'n'`).
// A non-literal `string` path yields `never`, so such callers pass no params object.
export type PathParams<P extends string> = P extends `${string}[${infer Name}]${infer Rest}`
    ? Name | PathParams<Rest>
    : never

// The params object a path requires — one `string | number` per declared `[name]`.
export type PathParamsArg<P extends string> = { [K in PathParams<P>]: string | number }

// Trailing args for `url(path, …)`: a params object only when the path declares `[name]` segments,
// followed by an optional query. Wrapping in a tuple (`[PathParams<P>] extends [never]`) blocks the
// distributive edge case when the union is `never`.
export type UrlArgs<P extends string> = [PathParams<P>] extends [never]
    ? [query?: UrlQuery]
    : [params: PathParamsArg<P>, query?: UrlQuery]

const DYNAMIC_SEGMENT = /\[([^\]]+)\]|(?<=\/):([A-Za-z0-9_]+)/g

// Whether a path declares any dynamic segment — the runtime split between the (path, params, query)
// and (path, query) call shapes. The `(?<=\/)` lookbehind keeps a colon-port (`host:8080`) or a URL
// scheme (`https:`) from reading as a `:name` param. A fresh non-global regex avoids the `lastIndex`
// state carried by the global `DYNAMIC_SEGMENT`.
export function hasDynamicSegments(path: string): boolean {
    return /\[[^\]]+\]|(?<=\/):[A-Za-z0-9_]+/.test(path)
}

export function resolveUrl(
    path: string,
    params: Record<string, string | number> | undefined,
    query: UrlQuery | undefined,
): string {
    const resolved = path.replace(
        DYNAMIC_SEGMENT,
        (_match, bracketName?: string, colonName?: string) => {
            const name = bracketName ?? colonName
            if (name === undefined) {
                throw new Error(`url(): malformed segment in path "${path}".`)
            }
            const value = params?.[name]
            if (value === undefined) {
                throw new Error(`url(): missing param "${name}" for path "${path}".`)
            }
            return encodeURIComponent(String(value))
        },
    )
    return appendQuery(resolved, query)
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
