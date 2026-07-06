import { normalizePathname } from './normalizePathname.ts'
import type { RouteSegment } from './parseRouteSegments.ts'
import { parseRouteSegments } from './parseRouteSegments.ts'

/*
Per-route parse cache. The route set is stable across a session, so parsing a
pattern into segments is done once per route rather than on every match. Keyed
by the pattern string; entries never need eviction since routes don't churn.
*/
const PARSED_ROUTES = new Map<string, RouteSegment[]>()

function parsedRoute(route: string): RouteSegment[] {
    let segments = PARSED_ROUTES.get(route)
    if (segments === undefined) {
        segments = parseRouteSegments(route)
        PARSED_ROUTES.set(route, segments)
    }
    return segments
}

/* One pattern segment's specificity rank — lower is more specific. */
function segmentRank(segment: RouteSegment): number {
    if (segment.kind === 'literal') {
        return 0
    }
    if (segment.catchAll) {
        return 3
    }
    return segment.optional ? 2 : 1
}

/* Positional specificity between two routes that both match a path: walk both
   patterns left to right, and at the first position where the segment kinds
   differ the more specific kind wins — literal > `[name]` > `[[name]]` >
   `[...rest]`. So `/a/[b]` beats `/[a]/b`, and a literal head beats a param
   head even against a catch-all tail (matching how Bun's own router ranked).
   Prefix-equal patterns: the shorter one is the exact match. A full tie keeps
   the earlier-registered route — deterministic, unlike count-based scoring,
   because kind sequences that differ anywhere are ordered at that position. */
function moreSpecific(candidate: RouteSegment[], best: RouteSegment[]): boolean {
    const shared = Math.min(candidate.length, best.length)
    for (let index = 0; index < shared; index += 1) {
        const candidateRank = segmentRank(candidate[index] as RouteSegment)
        const bestRank = segmentRank(best[index] as RouteSegment)
        if (candidateRank !== bestRank) {
            return candidateRank < bestRank
        }
    }
    return candidate.length < best.length
}

/*
The route matcher — the single grammar of record on both sides: the server's
fetch dispatch and the client router resolve a pathname through this same
function, so params decode and precedence agree by construction. Given the
registered route patterns and a pathname, returns the matching route + decoded
params, or undefined. Segments are literal / `[name]` / `[[name]]` (optional) /
`[...rest]` (catch-all), via the shared `parseRouteSegments`. The most specific
match wins (see moreSpecific).
*/
export function matchRoute(
    routes: string[],
    pathname: string,
): { route: string; params: Record<string, string> } | undefined {
    /* Match the canonical slash form — `//users` and `/users/` both match
       `/users` — otherwise the extra empty segment rejects the path or lets
       `/users/[id]` capture an empty id. The server redirects a request whose
       raw pathname differs from this form before dispatching (see createServer),
       so its auth middleware guards the same string this matcher routes. */
    const normalized = normalizePathname(pathname)
    const pathSegments = normalized.split('/')
    let best: { route: string; params: Record<string, string>; parsed: RouteSegment[] } | undefined
    for (const route of routes) {
        const parsed = parsedRoute(route)
        const params = matchSegments(parsed, pathSegments)
        if (params === undefined) {
            continue
        }
        if (best === undefined || moreSpecific(parsed, best.parsed)) {
            best = { route, params, parsed }
        }
    }
    return best === undefined ? undefined : { route: best.route, params: best.params }
}

/* Percent-decodes a captured value. Lenient — a malformed sequence (`/%E0%A4%A`)
   keeps the raw text rather than throwing, so a bad escape in a navigation or
   request can't crash matching; the downstream lookup just misses naturally. */
function decodeParam(value: string): string {
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}

/* Matches one parsed pattern against the path's segments, capturing decoded
   params; undefined on mismatch. */
function matchSegments(
    segments: RouteSegment[],
    pathSegments: string[],
): Record<string, string> | undefined {
    const params: Record<string, string> = {}
    return matchFrom(segments, pathSegments, 0, 0, params) ? params : undefined
}

/*
Depth-first walk over the pattern. An optional segment first tries to consume a
path segment (greedy — `/[[a]]/[[b]]` on `/x` captures `a`), and on a deeper
mismatch backtracks to try absence, un-capturing its param so a failed branch
can't leak into the succeeding one. Recursion depth is bounded by the pattern's
segment count, not the request path. A catch-all consumes every remaining
segment (possibly none), decoding each sub-segment while keeping `/` separators
— so an encoded `%2F` stays inside one sub-segment.
*/
function matchFrom(
    segments: RouteSegment[],
    pathSegments: string[],
    segmentIndex: number,
    pathIndex: number,
    params: Record<string, string>,
): boolean {
    if (segmentIndex === segments.length) {
        /* Pattern exhausted — the path must be too (no extra segments). */
        return pathIndex === pathSegments.length
    }
    const segment = segments[segmentIndex]
    if (segment === undefined) {
        return false
    }
    if (segment.kind === 'param' && segment.catchAll) {
        params[segment.name] = pathSegments.slice(pathIndex).map(decodeParam).join('/')
        return true
    }
    const value = pathSegments[pathIndex]
    if (segment.kind === 'literal') {
        if (value !== segment.value) {
            return false
        }
        return matchFrom(segments, pathSegments, segmentIndex + 1, pathIndex + 1, params)
    }
    if (segment.optional) {
        /* Consume first; on failure restore the prior capture (a same-named
           earlier `[name]` must survive the backtrack) and retry as absent. An
           optional never captures an empty segment. */
        if (value !== undefined && value !== '') {
            const previous = params[segment.name]
            params[segment.name] = decodeParam(value)
            if (matchFrom(segments, pathSegments, segmentIndex + 1, pathIndex + 1, params)) {
                return true
            }
            if (previous === undefined) {
                delete params[segment.name]
            } else {
                params[segment.name] = previous
            }
        }
        if (matchFrom(segments, pathSegments, segmentIndex + 1, pathIndex, params)) {
            return true
        }
        /* Absent at the bare root: `/` splits into ['', ''] and slash collapsing
           can't remove that dangling empty segment, so an absent optional also
           swallows it — `/[[lang]]` must match `/` (the path url() generates). */
        if (value === '') {
            return matchFrom(segments, pathSegments, segmentIndex + 1, pathIndex + 1, params)
        }
        return false
    }
    /* A required `[name]` param never captures an empty segment (e.g. `/users//5`). */
    if (value === undefined || value === '') {
        return false
    }
    params[segment.name] = decodeParam(value)
    return matchFrom(segments, pathSegments, segmentIndex + 1, pathIndex + 1, params)
}
