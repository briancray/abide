import type { Segment } from './routePattern.ts'

/**
 * The params a pattern matched, by name: a string, or a list for a rest.
 *
 * The params are strings because that is what a URL carries; `ParamsOf<P>` accepts a number on the
 * way OUT (30.3) and the address is built from it, but nothing on the way back in has a type to
 * restore.
 */
export type Params = Record<string, string | string[]>

/**
 * A pathname's non-empty parts, each percent-decoded, or `undefined` where one will not decode.
 *
 * The pathname taken apart, once. `firstMatch` walks a whole table against ONE address, so the
 * split and the per-part decode belong to the walk rather than to each candidate in it, or a
 * table of n routes splits and decodes the address n times.
 *
 * `undefined` FOR AN ADDRESS THAT WILL NOT PERCENT-DECODE, which names nothing: the server answers
 * it 400 (15.16) and the router leaves it to the document (30.10). A throw here reached the
 * router's link listeners, which are the one place nothing catches it.
 */
export function partsOf(pathname: string): string[] | undefined {
    const parts: string[] = []
    try {
        for (const part of pathname.split('/'))
            if (part !== '') parts.push(decodeURIComponent(part))
    } catch {
        return undefined
    }
    return parts
}

/**
 * Whether `segments` match the front of `parts`.
 *
 * 35.2 — with the same meaning each segment kind has in a route: the directories an error page
 * stands for cover every address below them.
 */
export function coversPrefix(segments: Segment[], parts: string[]): boolean {
    return walk(segments, 0, parts, 0, true) !== null
}

// ONE SEGMENT AT A TIME, and the params built on the way back out: a candidate that fails
// allocates nothing, and one pattern that matches allocates one record. 30.4 — AN OPTIONAL IS TRIED
// TAKEN, THEN LEFT OUT, so `/[[lang]]/docs` matches `/docs` as well as `/en/docs`: taking the part
// greedily and never trying without it is how a left-out optional stopped omitting its segment.
function walk(
    segments: Segment[],
    index: number,
    parts: string[],
    at: number,
    prefix: boolean,
): Params | null {
    if (index === segments.length)
        return prefix || at === parts.length ? {} : null
    const segment = segments[index] as Segment
    // 30.5 — A REST TAKES THE MOST THE SEGMENTS AFTER IT LEAVE, nothing included, so a handler's
    // name after one (`/docs/[...path]/save`) is reached rather than spent on the rest.
    if (segment.kind === 'rest') {
        for (let end = parts.length; end >= at; end -= 1) {
            const params = walk(segments, index + 1, parts, end, prefix)
            if (params !== null) {
                params[segment.name] = parts.slice(at, end)
                return params
            }
        }
        return null
    }
    const part = parts[at]
    if (segment.kind === 'optional') {
        if (part !== undefined) {
            const taken = walk(segments, index + 1, parts, at + 1, prefix)
            if (taken !== null) {
                taken[segment.name] = part
                return taken
            }
        }
        return walk(segments, index + 1, parts, at, prefix)
    }
    if (part === undefined) return null
    if (segment.kind === 'static' && part !== segment.name) return null
    const params = walk(segments, index + 1, parts, at + 1, prefix)
    if (params !== null && segment.kind === 'required')
        params[segment.name] = part
    return params
}

/**
 * The first route whose pattern matches `parts`, with its params, or `undefined`.
 *
 * 30.9 — THE FIRST PATTERN THAT MATCHES WINS, over a table already ranked most-specific-first.
 * The client router resolves through this, and the server walks the same ranked table with
 * `matchOf`, passing a route with no answer for the method asked. The two resolving one address
 * alike is the isomorphism 30.8 rests on.
 *
 * Walked rather than compiled to a regex: a route table is matched once per navigation, so the
 * walk is never the cost, and a regex would have to encode three segment kinds in a grammar nobody
 * reading the table can see.
 */
export function firstMatch<T extends { segments: Segment[] }>(
    routes: T[],
    parts: string[],
): { route: T; params: Params } | undefined {
    for (const route of routes) {
        const params = walk(route.segments, 0, parts, 0, false)
        if (params !== null) return { route, params }
    }
    return undefined
}

/** The params `segments` match the whole of `parts` with, or `undefined` where they do not. */
export function matchOf(
    segments: Segment[],
    parts: string[],
): Params | undefined {
    return walk(segments, 0, parts, 0, false) ?? undefined
}
