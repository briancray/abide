// A ROUTE LITERAL, PARSED. One grammar for two things that would otherwise drift: the file a
// page is filed as (`invoices/[id]/page.abide`) and the literal an author writes
// (`'/invoices/[id]'`). The bracket spelling is the file system's, so the address is read off the
// tree rather than declared beside it and the two cannot disagree.
//
// 30.3, 30.4, 30.5 — the three segment kinds are the three the registry's `ParamsOf<P>` names:
// required takes a value, optional may be left out and omits its segment with it, and rest takes
// an array as well as a scalar.
//
// A LEAF: nothing imported but another leaf, because the compiler, the client router and a server
// router all read it and a constant crossing a seam lives where nothing pulls a graph in behind it.

import { PUBLIC_DIRECTORY, SERVER_DIRECTORY } from './RESERVED_DIRECTORIES.ts'

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

/** Whether a source is a page, a layout, an error page or a component. */
export type FileKind = 'page' | 'layout' | 'error' | 'component'

/**
 * Whether the `.abide` at `path` is a page, a layout, an error page or a component.
 *
 * AN ADDRESS RATHER THAN A NAME. The file name says which of the three it is, and only a file
 * whose place is an `address` (`placeOf`) is one: a `page.abide` under a `server` directory is a
 * component.
 * One test for every reader: the build's routes, the checker's `Routes` and the `route.params` a
 * page is typed by.
 *
 * `path` is RELATIVE TO THE APP'S ROOT: its directories are its route, so an absolute path would
 * read the machine's directories as the app's.
 */
export function fileKind(path: string): FileKind {
    if (placeOf(path) !== 'address') return 'component'
    // The WHOLE basename: `homepage.abide` ends with `page.abide` and is a component.
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (name === 'page.abide') return 'page'
    if (name === 'layout.abide') return 'layout'
    return name === 'error.abide' ? 'error' : 'component'
}

/** Where a file sits in an app, which is what it is to every reader (`placeOf`). */
export type Place = 'address' | 'server' | 'public' | 'dependency' | 'skipped'

/**
 * Where the file at `path`, relative to the app's root, sits — THE ONE ANSWER every walk, fence and
 * emit reads, so no two of them disagree about a path.
 *
 * - `dependency` — 34.28: a package's, outside the root or under `node_modules`, whose directories
 *   are its package's layout and none of the app's;
 * - `skipped` — under a dot directory, which no walk of the app enters;
 * - `server` or `public` — 23.15: under that reserved directory, the nearest to the root deciding
 *   (23.16 refuses one inside the other);
 * - `address` — 23.14: everywhere else, its directories the segments of its route.
 */
export function placeOf(path: string): Place {
    if (path.startsWith('../') || path.startsWith('/')) return 'dependency'
    const parts = path.split('/')
    // The last part is the file itself, which is never a directory.
    for (let index = 0; index < parts.length - 1; index += 1) {
        const part = parts[index] as string
        if (part === 'node_modules') return 'dependency'
        if (part.startsWith('.')) return 'skipped'
        if (part === SERVER_DIRECTORY) return 'server'
        if (part === PUBLIC_DIRECTORY) return 'public'
    }
    return 'address'
}

/** Whether a walk of the app passes over the entry `name`: a dot file or directory, or `node_modules`. */
export function skipped(name: string): boolean {
    return name.startsWith('.') || name === 'node_modules'
}

/**
 * The route a file answers at — its DIRECTORY's below the root, whatever its name.
 *
 * 23.14 — `media/[id]/page.abide` is `/media/[id]`, and so is every other file beside it, which is
 * what lets a directory's handlers sit in as many files as an author likes (16.2). `path` is
 * relative to the app's root, as `fileKind`'s is.
 */
export function routeOf(path: string): string {
    const parts = path.split('/')
    parts.pop()
    return `/${parts.filter((part) => part !== '').join('/')}`
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
export function rankRoutes<T extends { pattern: string }>(
    rows: T[],
): (T & { segments: Segment[] })[] {
    const ranked: (T & { segments: Segment[] })[] = []
    for (const row of rows)
        ranked.push({ ...row, segments: parseRoutePattern(row.pattern) })
    ranked.sort((a, b) => compareRoutes(a.segments, b.segments))
    return ranked
}
