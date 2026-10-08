// A ROUTE LITERAL, PARSED. One grammar for two things that would otherwise drift: the directory a
// page is filed under (`ui/pages/invoices/[id]/page.abide`) and the literal an author writes
// (`'/invoices/[id]'`). The bracket spelling is the file system's, so the address is read off the
// tree rather than declared beside it and the two cannot disagree.
//
// 30.3, 30.4, 30.5 — the three segment kinds are the three the registry's `ParamsOf<P>` names:
// required takes a value, optional may be left out and omits its segment with it, and rest takes
// an array as well as a scalar.
//
// A LEAF: no imports, because the compiler, the client router and a server router all read it and
// a constant crossing a seam lives where nothing pulls a graph in behind it.

type SegmentKind = 'static' | 'required' | 'optional' | 'rest'

/** One `/`-separated piece of a route literal, classified by kind. */
export type Segment = {
    kind: SegmentKind
    /** The literal text for a static segment, the param name for the other three. */
    name: string
}

/**
 * A route literal split into its segments, each classified by kind.
 *
 * `[...rest]`, `[[optional]]`, `[required]`, or a literal. Ordered longest-first: `[[a]]` is a
 * `[a]` with another bracket round it, so testing the short form first matches both.
 */
export function parseRoutePattern(pattern: string): Segment[] {
    const out: Segment[] = []
    for (const raw of pattern.split('/')) {
        if (raw === '') continue
        if (raw.startsWith('[[') && raw.endsWith(']]'))
            out.push({ kind: 'optional', name: raw.slice(2, -2) })
        else if (raw.startsWith('[...') && raw.endsWith(']'))
            out.push({ kind: 'rest', name: raw.slice(4, -1) })
        else if (raw.startsWith('[') && raw.endsWith(']'))
            out.push({ kind: 'required', name: raw.slice(1, -1) })
        else out.push({ kind: 'static', name: raw })
    }
    return out
}

const ROUTES = 'ui/pages/'

/** Whether a source is a page, a layout, an error page or a component. */
export type FileKind = 'page' | 'layout' | 'error' | 'component'

/**
 * Whether the `.abide` at `path` is a page, a layout, an error page or a component.
 *
 * AN ADDRESS RATHER THAN A NAME. Both halves are load-bearing: the file name is the address and
 * the directory is what says the address is a ROUTE rather than a component filed anywhere. One
 * test for every name (35.1 reads `layout.abide` the same way), so the directory half cannot be
 * got right for one and wrong for another — and one test for every reader: the build's routes,
 * the checker's `Routes` and the `route.params` a page is typed by.
 *
 * 23.3 — under `ui/pages/` and nowhere else: a `page.abide` filed in some other `pages/`
 * directory is a component, as it is to the `Routes` the checker declares. `path` may be relative
 * to the app or the project, or absolute.
 */
export function fileKind(path: string): FileKind {
    if (routesAt(path) === -1) return 'component'
    // The WHOLE basename: `homepage.abide` ends with `page.abide` and is a component.
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (name === 'page.abide') return 'page'
    if (name === 'layout.abide') return 'layout'
    return name === 'error.abide' ? 'error' : 'component'
}

/**
 * The route literal a page file is filed under, read off its path below `ui/pages/`.
 *
 * `page.abide` is an address rather than a name (CLAUDE.md), so the directories above it ARE the
 * route and the file itself contributes nothing.
 *
 * 23.3 — BELOW THE FIRST `ui/pages/`, which is the routes directory, and not below the last `pages/`:
 * a section an app files as `ui/pages/pages/` is the address `/pages`, and cutting at the last one
 * served `ui/pages/pages/add-a-page` at `/add-a-page` and gave `/` two pages.
 */
export function routeOf(pagePath: string): string {
    const at = routesAt(pagePath)
    const tail = at === -1 ? pagePath : pagePath.slice(at + ROUTES.length)
    const parts: string[] = []
    for (const part of tail.split('/'))
        if (part !== '' && !part.endsWith('.abide')) parts.push(part)
    return `/${parts.join('/')}`
}

/** Where the first `ui/pages/` in `path` begins, as whole directories, or -1. */
function routesAt(path: string): number {
    if (path.startsWith(ROUTES)) return 0
    const at = path.indexOf(`/${ROUTES}`)
    return at === -1 ? -1 : at + 1
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
 * THE SHORTER PATTERN WINS A TIE, and only an exhausted prefix can produce one: every segment the
 * two share is the same kind, so what is left is the extra segments of the longer, which can only
 * be optional or rest or the two would not match one path. `/a` admits one address and
 * `/a/[[b]]` admits two, so the shorter is the narrower claim.
 */
export function compareRoutes(a: Segment[], b: Segment[]): number {
    const shared = a.length < b.length ? a.length : b.length
    for (let at = 0; at < shared; at += 1) {
        const kind =
            specificity(b[at] as Segment) - specificity(a[at] as Segment)
        if (kind !== 0) return kind
    }
    return a.length - b.length
}

function specificity(segment: Segment): number {
    if (segment.kind === 'static') return 3
    if (segment.kind === 'required') return 2
    return segment.kind === 'optional' ? 1 : 0
}

/**
 * A route table compiled for matching: each row with its pattern parsed, most specific first.
 *
 * 30.9 — MOST SPECIFIC FIRST, for whichever seam is asking. The ranking POLICY is what decides
 * which page an address resolves to, so it is here with `compareRoutes` rather than written out
 * beside each table: the server's boot and the client router's start compile through one call.
 */
export function rankRoutes<T extends { pattern: string }>(
    rows: T[],
): (T & { segments: Segment[] })[] {
    const ranked: (T & { segments: Segment[] })[] = []
    for (const row of rows)
        ranked.push({ ...row, segments: parseRoutePattern(row.pattern) })
    ranked.sort((a, b) => compareRoutes(a.segments, b.segments))
    return ranked
}
