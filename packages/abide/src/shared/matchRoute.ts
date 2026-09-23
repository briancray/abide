import type { Segment } from './routePattern.ts'

// WHAT A PATTERN MATCHED, or `null`. The params are strings because that is what a URL carries;
// `ParamsOf<P>` accepts a number on the way OUT (30.3) and the address is built from it, but
// nothing on the way back in has a type to restore.
export type Params = Record<string, string | string[]>

// One pattern against one pathname. Walked rather than compiled to a regex: a route table is
// matched once per navigation, so the walk is never the cost, and a regex would have to encode
// three segment kinds in a grammar nobody reading the table can see.
export function matchRoute(
    segments: Segment[],
    pathname: string,
): Params | null {
    return matchParts(segments, partsOf(pathname))
}

// The pathname taken apart, once. `firstMatch` walks a whole table against ONE address, so the
// split and the per-part decode belong to the walk rather than to each candidate in it — a
// ninety-route table was splitting the path ninety times and decoding every segment ninety
// times to resolve one address, per request and per client navigation.
function partsOf(pathname: string): string[] {
    const parts: string[] = []
    for (const part of pathname.split('/'))
        if (part !== '') parts.push(decodeURIComponent(part))
    return parts
}

// ALLOCATED ON THE FIRST PARAM, not on entry. `firstMatch` calls this once per CANDIDATE, and most
// candidates die on their first static segment — a ninety-route table minted ninety records to
// resolve one address and threw eighty-nine of them away, for the same reason `partsOf` was
// hoisted out of the walk above. A pattern with no params never allocates at all.
function matchParts(segments: Segment[], parts: string[]): Params | null {
    let params: Params | null = null
    let at = 0
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index] as Segment
        // 30.5 — A REST TAKES WHAT IS LEFT, including nothing, and it is last by construction.
        if (segment.kind === 'rest') {
            ;(params ??= {})[segment.name] = parts.slice(at)
            return params
        }
        const part = parts[at]
        if (part === undefined) {
            // 30.4 — leaving an optional out omits its segment, so a pattern may outrun the path.
            if (segment.kind === 'optional') continue
            return null
        }
        if (segment.kind === 'static') {
            if (part !== segment.name) return null
        } else (params ??= {})[segment.name] = part
        at += 1
    }
    return at === parts.length ? (params ?? {}) : null
}

// 30.9 — THE FIRST PATTERN THAT MATCHES WINS, over a table already ranked most-specific-first.
// BOTH SEAMS WALK THIS ONE. The server resolving an address and the client router resolving the
// same one is the isomorphism 30.8 rests on, and it was two copies of this loop in two files
// whose comments each promised it was not.
export function firstMatch<T extends { segments: Segment[] }>(
    routes: T[],
    pathname: string,
): { route: T; params: Params } | undefined {
    const parts = partsOf(pathname)
    for (const route of routes) {
        const params = matchParts(route.segments, parts)
        if (params !== null) return { route, params }
    }
    return undefined
}
