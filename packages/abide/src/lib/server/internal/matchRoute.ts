// ROUTE PARAM MATCHING (M5b / abide-compiler C6) — match a request pathname against the set of
// page path patterns discovered by loadApp. A pattern is a page route path whose segments may be
// literal (`users`) or a `[name]` param placeholder (`/users/[id]`). matchRoute returns the winning
// pattern plus the extracted params, or null when nothing matches.
//
// Precedence: an exact (all-literal) match always beats a param match, so `/users/new` prefers a
// `/users/new` pattern over `/users/[id]`. Among param patterns, the first in sorted order wins —
// callers pass patterns already sorted (loadApp sorts its page keys), keeping this deterministic.

export interface RouteMatch {
  pattern: string;
  params: Record<string, string>;
}

// Split a path into non-empty segments. "/" → [], "/users/42" → ["users", "42"].
function segments(path: string): string[] {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  return trimmed.length === 0 ? [] : trimmed.split("/");
}

// A `[name]` segment captures into params[name]; a literal segment must match exactly. Returns the
// captured params on a full match, or null when the pattern does not fit this pathname.
function matchPattern(patternSegments: string[], pathSegments: string[]): Record<string, string> | null {
  if (patternSegments.length !== pathSegments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i++) {
    const patternSegment = patternSegments[i]!;
    const pathSegment = pathSegments[i]!;
    if (patternSegment.length > 2 && patternSegment.startsWith("[") && patternSegment.endsWith("]")) {
      params[patternSegment.slice(1, -1)] = decodeURIComponent(pathSegment);
    } else if (patternSegment !== pathSegment) {
      return null;
    }
  }
  return params;
}

// A pattern is exact when none of its segments are `[name]` placeholders.
function isExactPattern(patternSegments: string[]): boolean {
  for (const segment of patternSegments) {
    if (segment.startsWith("[") && segment.endsWith("]")) return false;
  }
  return true;
}

// Match `pathname` against `patterns` (page path keys). Exact routes win over param routes; among
// same-precedence matches the earliest pattern (by iteration order) wins.
export function matchRoute(patterns: string[], pathname: string): RouteMatch | null {
  const pathSegments = segments(pathname);
  let paramMatch: RouteMatch | null = null;
  for (const pattern of patterns) {
    const patternSegments = segments(pattern);
    const params = matchPattern(patternSegments, pathSegments);
    if (params === null) continue;
    if (isExactPattern(patternSegments)) return { pattern, params };
    if (paramMatch === null) paramMatch = { pattern, params };
  }
  return paramMatch;
}
