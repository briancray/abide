import type { RouteSegment } from '../shared/parseRouteSegments.ts'
import { parseRouteSegments } from '../shared/parseRouteSegments.ts'

/*
Per-route parse cache. The route set is stable across a session, so parsing a
pattern into segments (and counting its literals, the specificity tie-breaker) is
done once per route rather than twice per route on every navigation. Keyed by the
pattern string; entries never need eviction since routes don't churn.
*/
const PARSED_ROUTES = new Map<string, { segments: RouteSegment[]; literals: number }>()

function parsedRoute(route: string): { segments: RouteSegment[]; literals: number } {
    let parsed = PARSED_ROUTES.get(route)
    if (parsed === undefined) {
        const segments = parseRouteSegments(route)
        const literals = segments.filter((segment) => segment.kind === 'literal').length
        parsed = { segments, literals }
        PARSED_ROUTES.set(route, parsed)
    }
    return parsed
}

/*
Client route matcher: given the registered route patterns and the current
pathname, returns the matching route + decoded params, or undefined. Mirrors the
server's segment grammar via the shared `parseRouteSegments` (literal / `[name]` /
`[...rest]`), so client navigation decodes params the same way SSR does. The most
specific match wins — the pattern with the most literal segments — so a static
route beats a param route at the same depth.
*/
export function matchRoute(
    routes: string[],
    pathname: string,
): { route: string; params: Record<string, string> } | undefined {
    /* Normalize a trailing slash (except root) so `/users/` matches `/users` —
       otherwise the extra empty segment makes the length guard reject it (a 404 the
       server's own routing wouldn't give) or lets `/users/[id]` capture an empty id. */
    const normalized =
        pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
    const pathSegments = normalized.split('/')
    let best: { route: string; params: Record<string, string>; literals: number } | undefined
    for (const route of routes) {
        const parsed = parsedRoute(route)
        const params = matchSegments(parsed.segments, pathSegments)
        if (params === undefined) {
            continue
        }
        if (best === undefined || parsed.literals > best.literals) {
            best = { route, params, literals: parsed.literals }
        }
    }
    return best === undefined ? undefined : { route: best.route, params: best.params }
}

/* Percent-decodes a captured `[name]` value. Bun's `req.params` decoding is
   lenient (malformed sequences pass through), so mirror that by falling back to
   the raw value rather than throwing on a malformed `%` a page navigation would
   otherwise crash on. */
function decodeParam(value: string): string {
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}

/* Matches one parsed pattern against the path's segments, capturing params;
   undefined on mismatch. A catch-all consumes every remaining segment. */
function matchSegments(
    segments: RouteSegment[],
    pathSegments: string[],
): Record<string, string> | undefined {
    const params: Record<string, string> = {}
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index]
        if (segment === undefined) {
            return undefined
        }
        if (segment.kind === 'param' && segment.catchAll) {
            params[segment.name] = pathSegments.slice(index).join('/')
            return params
        }
        const value = pathSegments[index]
        if (value === undefined) {
            return undefined
        }
        if (segment.kind === 'literal') {
            if (segment.value !== value) {
                return undefined
            }
        } else {
            /* A `[name]` param never captures an empty segment (e.g. `/users//5`). */
            if (value === '') {
                return undefined
            }
            /* `url()` encodes a `[name]` value whole, and Bun decodes `req.params`
               server-side, so decode here to hand the page the same value SSR does
               (e.g. `The%20Daily%20Show` → `The Daily Show`). The catch-all above
               stays raw to match the server, which reconstructs it from the raw
               pathname. */
            params[segment.name] = decodeParam(value)
        }
    }
    /* No catch-all consumed the tail, so the path must have no extra segments. */
    return pathSegments.length === segments.length ? params : undefined
}
