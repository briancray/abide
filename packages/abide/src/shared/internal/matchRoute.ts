// ROUTE PARAM MATCHING (M5b / abide-compiler C6) — match a request pathname against the set of
// page path patterns discovered by loadApp. A pattern is a page route path whose segments may be:
//   - literal      (`users`)          → must match exactly
//   - `[name]`     (`/users/[id]`)    → required dynamic segment, captured as a string
//   - `[[name]]`   (`/blog/[[page]]`) → optional dynamic segment, matches zero or one segment here
//   - `[...name]`  (`/docs/[...path]`)→ rest / catch-all, captures the remaining segments as a `/`-joined string
// matchRoute returns the winning pattern plus the extracted params, or null when nothing matches.
//
// Optional (`[[name]]`) and rest (`[...name]`) make a pattern match paths of varying length, so a
// single pathname can match several patterns. Precedence picks the MOST SPECIFIC: an exact (all-
// literal) match always wins outright; otherwise patterns are ranked segment-by-segment where a more
// literal / required-earlier shape beats a catch-all (literal < required < optional < rest), with a
// longer pattern breaking a tie. Among equally-specific matches the earliest pattern (by iteration
// order — callers pass patterns already sorted) wins, keeping this deterministic.
//
// A rest segment is terminal (it consumes every remaining path segment); a rest that is not the last
// pattern segment simply won't match paths that have segments after it.

import { classifyRouteSegment, LITERAL, OPTIONAL, REQUIRED } from './routeSegmentKind.ts'

export interface RouteMatch {
    pattern: string
    params: Record<string, string>
}

// Segment kinds + the bracket grammar come from `routeSegmentKind`, shared with `resolveUrl` — the two
// are inverses (match a pathname / fill an href) and a disagreement makes a link no route can match.
// The kind values double as the specificity rank sorted on below (lower = more specific).
interface Segment {
    kind: number
    name: string
    literal: string
}

// Split a path into non-empty segments. "/" → [], "/users/42" → ["users", "42"].
function segments(path: string): string[] {
    const trimmed = path.replace(/^\/+|\/+$/g, '')
    return trimmed.length === 0 ? [] : trimmed.split('/')
}

// Classify one pattern segment, keeping the original text for the literal comparison below.
function classify(segment: string): Segment {
    const { kind, name } = classifyRouteSegment(segment)
    return { kind, name, literal: segment }
}

// Per-pattern classification cache. Route patterns come from the static page-route table (a small,
// stable set), so classifying `segments(pattern).map(classify)` on every request was pure recompute —
// the same regex-split + object allocations rebuilt per nav (and twice per soft-nav). The classified
// `Segment[]` is immutable (matching only reads it and mutates its own `params`), so it is safe to share
// across every request. Keyed by the pattern string, not the caller's array, so a fresh `Object.keys()`
// per request still hits.
const CLASSIFIED_PATTERNS = new Map<string, Segment[]>()

function classifyPattern(pattern: string): Segment[] {
    let classified = CLASSIFIED_PATTERNS.get(pattern)
    if (classified === undefined) {
        classified = segments(pattern).map(classify)
        CLASSIFIED_PATTERNS.set(pattern, classified)
    }
    return classified
}

// Recursive backtracking match of `pattern[patternIndex..]` against `path[pathIndex..]`, filling
// `params` as it goes. Optional segments try consuming one path segment, then zero; a rest segment
// greedily consumes every remaining segment (so it only matches as the terminal pattern segment).
function fill(
    pattern: Segment[],
    patternIndex: number,
    path: string[],
    pathIndex: number,
    params: Record<string, string>,
): boolean {
    if (patternIndex === pattern.length) return pathIndex === path.length
    const segment = pattern[patternIndex]
    if (segment === undefined) return false
    if (segment.kind === LITERAL) {
        if (pathIndex < path.length && path[pathIndex] === segment.literal) {
            return fill(pattern, patternIndex + 1, path, pathIndex + 1, params)
        }
        return false
    }
    if (segment.kind === REQUIRED) {
        const value = path[pathIndex]
        if (value === undefined) return false
        params[segment.name] = decodeURIComponent(value)
        if (fill(pattern, patternIndex + 1, path, pathIndex + 1, params)) return true
        delete params[segment.name]
        return false
    }
    if (segment.kind === OPTIONAL) {
        const value = path[pathIndex]
        if (value !== undefined) {
            params[segment.name] = decodeURIComponent(value)
            if (fill(pattern, patternIndex + 1, path, pathIndex + 1, params)) return true
            delete params[segment.name]
        }
        // Zero: skip this segment (param left absent) and match the rest of the pattern in place.
        return fill(pattern, patternIndex + 1, path, pathIndex, params)
    }
    // REST — consume every remaining path segment (possibly none) as a `/`-joined string, terminal.
    const rest: string[] = []
    for (let index = pathIndex; index < path.length; index++) {
        const value = path[index]
        if (value === undefined) return false
        rest.push(decodeURIComponent(value))
    }
    params[segment.name] = rest.join('/')
    return fill(pattern, patternIndex + 1, path, path.length, params)
}

// Match a classified pattern against a pathname's segments. Returns the captured params on a full
// match, or null when the pattern does not fit this pathname.
function matchPattern(pattern: Segment[], path: string[]): Record<string, string> | null {
    const params: Record<string, string> = {}
    return fill(pattern, 0, path, 0, params) ? params : null
}

// Whether every segment is literal — an exact route with no dynamic capture.
function isExact(pattern: Segment[]): boolean {
    for (const segment of pattern) {
        if (segment.kind !== LITERAL) return false
    }
    return true
}

// Compare two patterns' specificity. Negative → `a` is more specific (wins). Segment-by-segment, a
// lower kind (more literal) wins at the first difference; if one pattern is a prefix of the other, the
// longer (more constrained) pattern wins.
function moreSpecific(a: Segment[], b: Segment[]): number {
    const shared = Math.min(a.length, b.length)
    for (let index = 0; index < shared; index++) {
        const kindA = a[index]?.kind ?? LITERAL
        const kindB = b[index]?.kind ?? LITERAL
        if (kindA !== kindB) return kindA - kindB
    }
    return b.length - a.length
}

// Match `pathname` against `patterns` (page path keys). Exact routes win outright; otherwise the most
// specific dynamic pattern wins, ties broken by the earliest pattern in iteration order.
export function matchRoute(patterns: string[], pathname: string): RouteMatch | null {
    const pathSegments = segments(pathname)
    let best: RouteMatch | null = null
    let bestPattern: Segment[] | null = null
    for (const pattern of patterns) {
        const patternSegments = classifyPattern(pattern)
        const params = matchPattern(patternSegments, pathSegments)
        if (params === null) continue
        if (isExact(patternSegments)) return { pattern, params }
        if (bestPattern === null || moreSpecific(patternSegments, bestPattern) < 0) {
            best = { pattern, params }
            bestPattern = patternSegments
        }
    }
    return best
}
