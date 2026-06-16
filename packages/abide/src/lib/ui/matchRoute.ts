import { parseRouteSegments } from '../shared/parseRouteSegments.ts'

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
        const params = matchSegments(route, pathSegments)
        if (params === undefined) {
            continue
        }
        const literals = parseRouteSegments(route).filter(
            (segment) => segment.kind === 'literal',
        ).length
        if (best === undefined || literals > best.literals) {
            best = { route, params, literals }
        }
    }
    return best === undefined ? undefined : { route: best.route, params: best.params }
}

/* Matches one pattern against the path's segments, capturing params; undefined on
   mismatch. A catch-all consumes every remaining segment. */
function matchSegments(route: string, pathSegments: string[]): Record<string, string> | undefined {
    const segments = parseRouteSegments(route)
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
            params[segment.name] = value
        }
    }
    /* No catch-all consumed the tail, so the path must have no extra segments. */
    return pathSegments.length === segments.length ? params : undefined
}
