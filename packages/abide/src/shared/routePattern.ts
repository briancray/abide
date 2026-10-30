// A ROUTE LITERAL, PARSED. One grammar for two things that would otherwise drift: the file a
// page is filed as (`invoices/[id].abide`) and the literal an author writes
// (`'/invoices/[id]'`). The bracket spelling is the file system's, so the address is read off the
// tree rather than declared beside it and the two cannot disagree.
//
// 30.3, 30.4, 30.5 — the three segment kinds are the three the registry's `ParamsOf<P>` names:
// required takes a value, optional may be left out and omits its segment with it, and rest takes
// an array as well as a scalar.
//
// A LEAF: nothing imported but another leaf, because the compiler, the client router and a server
// router all read it and a constant crossing a seam lives where nothing pulls a graph in behind it.

type SegmentKind = 'static' | 'required' | 'optional' | 'rest'

/** One `/`-separated piece of a route literal, classified by kind. */
export type Segment = {
    kind: SegmentKind
    /** The literal text for a static segment, the param name for the other three. */
    name: string
    /** 23.26 — the matcher a dynamic segment names after `=`, or `undefined` where it names none. */
    matcher: string | undefined
    /** 30.34, 30.35 — what a part must match to be taken: the matcher's, or the period default. */
    accepts: RegExp
}

/** 30.34, 30.36 — what a segment naming no matcher takes: a part carrying no period. */
const PERIODLESS = /^[^.]+$/

// A segment naming a matcher, parsed with no table to resolve it in, takes nothing: only a route
// table's own rows say which regex a name stands for (23.26), and a reader that only builds an
// address or compares shapes never walks one.
const UNRESOLVED = /(?!)/

/**
 * A route literal split into its segments, each classified by kind.
 *
 * `[...rest]`, `[[optional]]`, `[required]`, or a literal, each dynamic one optionally naming a
 * matcher after `=`, compiled from `matchers` — each name's anchored source, as the build wrote it
 * into the row (23.26) — where a route table hands its row's. Ordered
 * longest-first: `[[a]]` is a `[a]` with another bracket round it, so testing the short form first
 * matches both.
 */
export function parseRoutePattern(
    pattern: string,
    matchers?: Record<string, string>,
): Segment[] {
    const out: Segment[] = []
    for (const raw of pattern.split('/')) {
        if (raw === '') continue
        let kind: SegmentKind = 'static'
        let body = raw
        if (raw.startsWith('[[') && raw.endsWith(']]')) {
            kind = 'optional'
            body = raw.slice(2, -2)
        } else if (raw.startsWith('[...') && raw.endsWith(']')) {
            kind = 'rest'
            body = raw.slice(4, -1)
        } else if (raw.startsWith('[') && raw.endsWith(']')) {
            kind = 'required'
            body = raw.slice(1, -1)
        }
        const split = kind === 'static' ? -1 : body.indexOf('=')
        const matcher = split === -1 ? undefined : body.slice(split + 1)
        out.push({
            kind,
            name: split === -1 ? body : body.slice(0, split),
            matcher,
            accepts:
                matcher === undefined
                    ? PERIODLESS
                    : matchers === undefined
                      ? UNRESOLVED
                      : resolvedIn(matchers, matcher, pattern),
        })
    }
    return out
}

function resolvedIn(
    matchers: Record<string, string>,
    matcher: string,
    pattern: string,
): RegExp {
    const source = matchers[matcher]
    if (source === undefined)
        throw new Error(
            `abide: the route table's row for ${pattern} carries no matcher ${matcher}, which the build writes beside every segment naming one. RULEBOOK 23.26.`,
        )
    return new RegExp(source)
}

/**
 * A `sort` comparator over two parsed patterns: negative where `a` is the more specific.
 *
 * 30.9 — HOW SPECIFIC A PATTERN IS, so `/invoices/new` is tried before `/invoices/[id]` however the
 * build happened to walk the tree. Negative where `a` is the more specific, which is `sort`'s own
 * order and so the one this is read in.
 *
 * SEGMENT BY SEGMENT, LEFT TO RIGHT, rather than by a score summed over the whole pattern. A sum
 * cannot carry an ORDERING over kinds: the first thing it loses is position, so `/[id]/edit` and
 * `/new/[tab]` come out equal and `/new/edit` resolves by whichever the build walked first — the
 * thing this function exists to stop. Weighting length on top of that then loses the kinds
 * themselves, and `/x` ranked BELOW `/[[a]]/[[b]]` for the path `/x`: a static segment beaten by
 * two optionals, which is 30.9 exactly inverted. Both were live on the scalar this replaced.
 *
 * WHERE ONE PATTERN ENDS, ITS END RANKS AS A SEGMENT: below a static or a required one and above an
 * optional or a rest. `/a` admits one address and `/a/[[b]]` admits two, so the shorter is the
 * narrower claim; but `/[[lang]]` and `/[[lang]]/about` both match `/about`, the longer by a static
 * segment where the shorter spends `about` on an optional, so there the longer is.
 */
export function compareRoutes(a: Segment[], b: Segment[]): number {
    const longest = a.length > b.length ? a.length : b.length
    for (let at = 0; at < longest; at += 1) {
        const kind = specificity(b[at]) - specificity(a[at])
        if (kind !== 0) return kind
    }
    return 0
}

function specificity(segment: Segment | undefined): number {
    if (segment === undefined) return 2
    if (segment.kind === 'static') return 4
    if (segment.kind === 'required') return 3
    return segment.kind === 'optional' ? 1 : 0
}

/**
 * Whether `outer` is the front of `route`: a static segment by name, a parameter by kind.
 *
 * 35.1, 37.2 — what a layout wraps and what a route's hooks run over: the routes at or below its
 * own, a parameter's name aside, so `/media/[id]` covers `/media/[slug]/edit`.
 */
export function coversRoute(outer: Segment[], route: Segment[]): boolean {
    if (outer.length > route.length) return false
    for (let at = 0; at < outer.length; at += 1) {
        const one = outer[at] as Segment
        const two = route[at] as Segment
        if (one.kind !== two.kind) return false
        if (one.kind === 'static' && one.name !== two.name) return false
    }
    return true
}

/**
 * A route table compiled for matching: each row with its pattern parsed, most specific first.
 *
 * 30.9 — MOST SPECIFIC FIRST, for whichever seam is asking. The ranking POLICY is what decides
 * which page an address resolves to, so it is here with `compareRoutes` rather than written out
 * beside each table: the server's boot and the client router's start compile through one call.
 */
export function rankRoutes<
    T extends { pattern: string; matchers?: Record<string, string> },
>(rows: T[]): (T & { segments: Segment[] })[] {
    const ranked: (T & { segments: Segment[] })[] = []
    for (const row of rows)
        ranked.push({
            ...row,
            segments: parseRoutePattern(row.pattern, row.matchers ?? {}),
        })
    ranked.sort((a, b) => compareRoutes(a.segments, b.segments))
    return ranked
}
