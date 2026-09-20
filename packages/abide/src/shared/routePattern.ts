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

export type Segment = {
    kind: SegmentKind
    // The literal text for a static segment, the param name for the other three.
    name: string
}

// `[...rest]`, `[[optional]]`, `[required]`, or a literal. Ordered longest-first: `[[a]]` is a
// `[a]` with another bracket round it, so testing the short form first matches both.
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

// THE PAGE'S ADDRESS FROM ITS PATH. `page.abide` is an address rather than a name (CLAUDE.md), so
// the directories above it ARE the route and the file itself contributes nothing.
export function routeOf(pagePath: string): string {
    const at = pagePath.lastIndexOf('/pages/')
    const tail = at === -1 ? pagePath : pagePath.slice(at + '/pages/'.length)
    const parts: string[] = []
    for (const part of tail.split('/'))
        if (part !== '' && !part.endsWith('.abide')) parts.push(part)
    return `/${parts.join('/')}`
}

// 30.9 — HOW SPECIFIC A PATTERN IS, so `/invoices/new` is tried before `/invoices/[id]` however the
// build happened to walk the tree. Negative where `a` is the more specific, which is `sort`'s own
// order and so the one this is read in.
//
// SEGMENT BY SEGMENT, LEFT TO RIGHT, rather than by a score summed over the whole pattern. A sum
// cannot carry an ORDERING over kinds: the first thing it loses is position, so `/[id]/edit` and
// `/new/[tab]` come out equal and `/new/edit` resolves by whichever the build walked first — the
// thing this function exists to stop. Weighting length on top of that then loses the kinds
// themselves, and `/x` ranked BELOW `/[[a]]/[[b]]` for the path `/x`: a static segment beaten by
// two optionals, which is 30.9 exactly inverted. Both were live on the scalar this replaced.
//
// THE SHORTER PATTERN WINS A TIE, and only an exhausted prefix can produce one: every segment the
// two share is the same kind, so what is left is the extra segments of the longer, which can only
// be optional or rest or the two would not match one path. `/a` admits one address and
// `/a/[[b]]` admits two, so the shorter is the narrower claim.
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
