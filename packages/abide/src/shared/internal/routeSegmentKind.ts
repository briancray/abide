// THE bracket grammar for a route path segment, in one place.
//
// A page route path is built from four segment forms, and two modules have to agree on exactly what
// each looks like: `matchRoute` decides whether a PATHNAME matches a pattern, and `resolveUrl` fills a
// pattern back into an href. They are inverses, so a disagreement produces a link that no route can
// match — which is not hypothetical. `resolveUrl` records that it already happened once: `/:name` was
// filled as a param on one side and matched literally on the other.
//
// The two carried character-identical classification — same length guards, same slice offsets, same
// ORDER — as two private copies. Order is the part that is easy to get subtly wrong and impossible to
// notice: `[[name]]` and `[...name]` must both be tested before the plain `[name]` form, because a
// `[[page]]` also satisfies "starts with `[`, ends with `]`" and would classify as a REQUIRED segment
// named `[page]`. That is a rule worth stating once.
//
// The kind values double as the SPECIFICITY rank `matchRoute` sorts on (lower = more specific), which
// is why they are ordered literal < required < optional < rest rather than alphabetically or by when
// they were added.

export const LITERAL = 0
export const REQUIRED = 1
export const OPTIONAL = 2
export const REST = 3

export type RouteSegmentKind = typeof LITERAL | typeof REQUIRED | typeof OPTIONAL | typeof REST

export interface ClassifiedSegment {
    kind: RouteSegmentKind
    // The param name, or '' for a literal segment.
    name: string
}

// Classify one pattern segment. Anything not matching a bracket form is a literal — including a
// malformed bracket (`[name`, `]name[`), which is treated as text rather than guessed at, so a typo
// fails as "this route does not match" instead of silently capturing a param under a mangled name.
export function classifyRouteSegment(segment: string): ClassifiedSegment {
    if (segment.length > 4 && segment.startsWith('[[') && segment.endsWith(']]')) {
        return { kind: OPTIONAL, name: segment.slice(2, -2) }
    }
    if (segment.length > 5 && segment.startsWith('[...') && segment.endsWith(']')) {
        return { kind: REST, name: segment.slice(4, -1) }
    }
    if (segment.length > 2 && segment.startsWith('[') && segment.endsWith(']')) {
        return { kind: REQUIRED, name: segment.slice(1, -1) }
    }
    return { kind: LITERAL, name: '' }
}
