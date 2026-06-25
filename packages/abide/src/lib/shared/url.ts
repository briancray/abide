import { basePath } from './basePath.ts'
import type { RouteSegment } from './parseRouteSegments.ts'
import { parseRouteSegments } from './parseRouteSegments.ts'
import { queryStringFromArgs } from './queryStringFromArgs.ts'

/* `undefined` is allowed and dropped (queryStringFromArgs skips it), so an
   optional field — url('/p', { ref: maybeUndefined }) — types without a guard. */
type QueryValue = string | number | boolean | undefined
type Query = Record<string, QueryValue>

/*
Augmentable rpc map. Codegen emits a `declare module '<importName>/shared/url'`
block filling this with `'/rpc/<file>': args` for each query-carrying (GET)
verb, so url('/rpc/search', { q }) types its args against the verb's own
signature. Empty by default — an absent entry falls through to the page/asset
branch, so the helper works before the generated d.ts lands.
*/
// @documentation url
// biome-ignore lint/suspicious/noEmptyInterface: augmented by the generated rpc.d.ts
export interface RpcRoutes {}

/*
Augmentable autocomplete sets — keys only, values unused. The page codegen
(writeRoutesDts) fills PageRoutes with each route path, the public codegen
(writePublicAssetsDts) fills PublicAssets with each `public/` file path. They
exist purely so editors suggest known paths; PathParams still derives a page's
params from the literal, so neither map drives typing.
*/
// biome-ignore lint/suspicious/noEmptyInterface: augmented by the generated routes.d.ts
export interface PageRoutes {}
// biome-ignore lint/suspicious/noEmptyInterface: augmented by the generated publicAssets.d.ts
export interface PublicAssets {}

/*
Known in-app paths for autocomplete. `(string & {})` at the call site keeps any
string accepted (dynamic/raw/external paths) — there's no hard route-existence
error, which would reject assets and interpolated strings — while these light
up suggestions once codegen lands.
*/
type KnownPath = keyof PageRoutes | keyof RpcRoutes | keyof PublicAssets

/*
Pulls the `[name]` / `[...rest]` params a route literal declares straight from
the path type, so url('/product/[id]', …) requires `id` without a generated
shape map. Values accept string | number (stringified on output). A path with
no bracket segments yields {}, which collapses the params slot away. The
catch-all branch recurses on its head too, so `[name]` segments before a
`[...rest]` are kept.
*/
export type PathParams<P extends string> = P extends `${infer Head}[...${infer Rest}]${infer Tail}`
    ? PathParams<Head> & { [K in Rest]: string | number } & PathParams<Tail>
    : P extends `${string}[${infer Name}]${infer Tail}`
      ? { [K in Name]: string | number } & PathParams<Tail>
      : // biome-ignore lint/complexity/noBannedTypes: {} is the "no params" base case — keyof {} is never, which collapses the params slot; Record<string, never> would not (keyof is string)
        {}

/*
Resolves any in-app URL to its base-correct, typed form — the single chokepoint
so a project mounted under APP_URL's subpath (e.g. /v2) generates links, asset
refs, and rpc hrefs that stay within the mount. Three disjoint URL kinds, keyed
off the path:
  - rpc (flat /rpc/*, present in RpcRoutes): the verb's args, serialised to query.
  - page route (has [name] segments): path params, then optional query.
  - asset / paramless / raw: bare path, then optional query.
External URLs (scheme-qualified or protocol-relative) skip the base untouched,
as do non-rooted specifiers — base only ever prefixes a rooted internal path.
*/
export function url<P extends KnownPath | (string & {})>(
    path: P,
    ...args: P extends keyof RpcRoutes
        ? undefined extends RpcRoutes[P]
            ? [args?: RpcRoutes[P]]
            : [args: RpcRoutes[P]]
        : keyof PathParams<P> extends never
          ? [query?: Query]
          : [params: PathParams<P>, query?: Query]
): string
export function url(path: string, first?: Query, second?: Query): string {
    // Scheme-qualified (http:, mailto:) or protocol-relative URLs are external — leave them whole.
    if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) {
        return appendQuery(path, first)
    }
    const segments = parseRouteSegments(path)
    const hasParams = segments.some((segment) => segment.kind === 'param')
    // With path params the second arg is the query; without, the first arg is.
    const query = hasParams ? second : first
    const resolved = hasParams ? interpolate(segments, first ?? {}) : path
    // Base only prefixes rooted internal paths; relative specifiers are left alone.
    const prefixed = resolved.startsWith('/') ? basePath() + resolved : resolved
    return appendQuery(prefixed, query)
}

/* Substitutes `[name]` / `[...rest]` segments with their stringified, URL-encoded
   param values (matching the query side, which encodes too). A `[name]` value is
   encoded whole so `/`, `?`, `#`, and spaces can't alter the path structure; a
   `[...rest]` catch-all keeps its `/` separators and encodes each sub-segment. */
function interpolate(segments: RouteSegment[], params: Query): string {
    return segments
        .map((segment) => {
            if (segment.kind === 'literal') {
                return segment.value
            }
            const value = String(params[segment.name])
            return segment.catchAll
                ? value.split('/').map(encodeURIComponent).join('/')
                : encodeURIComponent(value)
        })
        .join('/')
}

/* Appends a `?`-query built from the same encoder buildRpcRequest uses, or nothing. */
function appendQuery(target: string, query: Query | undefined): string {
    if (!query) {
        return target
    }
    const queryString = queryStringFromArgs(query, false)
    return queryString ? `${target}?${queryString}` : target
}
