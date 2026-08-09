// What a route pattern IS, and the three things anyone does with one: parse it, order it against
// another, and run a path through it.
//
// Pure and allocation-shy on purpose. A table match runs every pattern against ONE path, so the path
// is split once by the caller and handed in as an array — the alternative, a regex per pattern, has
// to re-scan the whole string once per route and cannot hand back its captures by name without a
// second object.
//
// The four segment kinds are ordered by SPECIFICITY, so precedence is `kind - kind` and the sort is
// the ordering the spec states: literal > required > optional > rest.

const LITERAL = 0
const REQUIRED = 1
const OPTIONAL = 2
const REST = 3
// Past the end of a pattern. More specific than any segment, so `/a` outranks `/a/[[b]]` — the
// pattern that stops is the one that claimed the shorter path deliberately.
const END = -1

interface Segment {
    kind: number
    /** The literal text, or the parameter's name. */
    text: string
}

export interface Pattern {
    /** The pattern as written. This is a route's NAME — what `route().name` reports. */
    path: string
    segments: Segment[]
    /** Every parameter the pattern names, in order — what `buildPath` checks a caller's keys against. */
    names: string[]
    /**
     * How many path segments `segments[i…]` still REQUIRES. An optional consults it to decide
     * whether the segment in front of it is its own or belongs to what follows: `/a/[[x]]/b` over
     * `/a/b` must leave `b` for the literal, and only a count of what is still owed can say so.
     */
    needed: number[]
}

export type Params = Readonly<Record<string, string>>

/**
 * The params object a route with none hands back. One frozen object, so a reader of `route().params`
 * on a parameterless route sees the same identity every time and never wakes for it.
 */
export const NO_PARAMS: Params = Object.freeze({})

/** A pathname as segments, with the empties dropped — so `/a/b/` and `/a/b` are one path. */
export function splitPath(pathname: string): string[] {
    const parts: string[] = []
    let at = 0
    while (at < pathname.length) {
        let end = pathname.indexOf('/', at)
        if (end === -1) end = pathname.length
        if (end > at) parts.push(pathname.slice(at, end))
        at = end + 1
    }
    return parts
}

// Probes before it decodes, the way `escape` probes before it replaces: a path segment with nothing
// escaped in it is the common case and should cost one scan, not a decode.
function decode(text: string): string {
    return text.indexOf('%') === -1 ? text : decodeURIComponent(text)
}

function bad(path: string, why: string): never {
    throw new Error(`abide: the route pattern "${path}" ${why}`)
}

/**
 * `/users/[id]/posts/[[page]]` → segments. A part that does not START with `[` is a literal, so a
 * bracket inside an ordinary segment is left alone; one that does must be a well-formed placeholder,
 * because a half-written `[id` is a typo every time and matching it literally hides that forever.
 */
export function parsePattern(path: string): Pattern {
    const segments: Segment[] = []
    const names: string[] = []
    const parts = splitPath(path)
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i] as string
        if (part.charCodeAt(0) !== 91 /* [ */) {
            segments.push({ kind: LITERAL, text: part })
            continue
        }
        if (part.charCodeAt(part.length - 1) !== 93 /* ] */) bad(path, `has an unclosed segment "${part}"`)
        let kind = REQUIRED
        let name = part.slice(1, -1)
        if (name.charCodeAt(0) === 91 /* [ */) {
            if (name.charCodeAt(name.length - 1) !== 93 /* ] */) {
                bad(path, `has an unclosed optional segment "${part}"`)
            }
            kind = OPTIONAL
            name = name.slice(1, -1)
        } else if (name.startsWith('...')) {
            kind = REST
            name = name.slice(3)
        }
        if (name === '' || name.includes('[') || name.includes(']')) {
            bad(path, `has a segment "${part}" that does not name a parameter`)
        }
        if (names.includes(name)) bad(path, `names "${name}" twice`)
        if (kind === REST && i !== parts.length - 1) {
            bad(path, `puts the rest segment "${part}" before the end — a catch-all is terminal`)
        }
        names.push(name)
        segments.push({ kind, text: name })
    }

    const needed = new Array<number>(segments.length + 1)
    needed[segments.length] = 0
    for (let i = segments.length - 1; i >= 0; i--) {
        const kind = (segments[i] as Segment).kind
        needed[i] = (needed[i + 1] as number) + (kind === LITERAL || kind === REQUIRED ? 1 : 0)
    }
    return { path, segments, names, needed }
}

/**
 * Run a split path through one pattern. `null` is "no match"; a match hands back its params, and
 * `NO_PARAMS` when there are none — never a fresh empty object, which a reader would wake for.
 */
export function matchPattern(pattern: Pattern, parts: string[]): Params | null {
    const segments = pattern.segments
    let params: Record<string, string> | null = null
    let at = 0
    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i] as Segment
        const kind = segment.kind
        if (kind === LITERAL) {
            if (parts[at] !== segment.text) return null
            at++
            continue
        }
        if (kind === REQUIRED) {
            const part = parts[at]
            if (part === undefined) return null
            if (params === null) params = {}
            params[segment.text] = decode(part)
            at++
            continue
        }
        if (kind === OPTIONAL) {
            // Greedy, but only as far as what follows can still be paid for.
            if (parts.length - at > (pattern.needed[i + 1] as number)) {
                if (params === null) params = {}
                params[segment.text] = decode(parts[at] as string)
                at++
            }
            continue
        }
        // REST, and terminal by construction: it takes whatever is left, including nothing.
        if (params === null) params = {}
        let rest = ''
        for (let j = at; j < parts.length; j++) rest += (j === at ? '' : '/') + decode(parts[j] as string)
        params[segment.text] = rest
        at = parts.length
    }
    if (at !== parts.length) return null
    return params === null ? NO_PARAMS : params
}

/**
 * Precedence, as a sort: literal > required > optional > rest, segment by segment. Ordering the
 * table ONCE is what lets a match be a walk that stops at the first hit — the alternative is
 * scoring every hit and keeping the best, which visits every route on every navigation.
 */
export function comparePatterns(left: Pattern, right: Pattern): number {
    const length = left.segments.length > right.segments.length ? left.segments.length : right.segments.length
    for (let i = 0; i < length; i++) {
        const a = i < left.segments.length ? (left.segments[i] as Segment).kind : END
        const b = i < right.segments.length ? (right.segments[i] as Segment).kind : END
        if (a !== b) return a - b
    }
    // Two patterns of the same shape can still both match — `/a/[x]` and `/a/[y]` — so the order has
    // to be total, or a table's meaning would depend on the sort's stability.
    return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
}

/**
 * The inverse: a pattern plus params back to a path. A missing required param THROWS rather than
 * producing `/users/undefined` — an href that silently points at the wrong page is worse than one
 * that is never built.
 */
export function buildPath(pattern: Pattern, params?: Record<string, unknown>): string {
    let out = ''
    for (const segment of pattern.segments) {
        if (segment.kind === LITERAL) {
            out += `/${segment.text}`
            continue
        }
        const value = params === undefined ? undefined : params[segment.text]
        if (segment.kind === REST) {
            const rest = Array.isArray(value) ? value.join('/') : value === undefined ? '' : String(value)
            if (rest !== '') {
                const parts = splitPath(rest)
                for (const part of parts) out += `/${encodeURIComponent(part)}`
            }
            continue
        }
        if (value === undefined || value === null) {
            if (segment.kind === OPTIONAL) continue
            throw new Error(
                `abide: url("${pattern.path}") needs a "${segment.text}" — a required segment cannot be left out`,
            )
        }
        out += `/${encodeURIComponent(String(value))}`
    }
    // A name that matched no segment is a typo far more often than it is a query parameter someone
    // meant to pass positionally, and dropping it silently builds an href to the wrong place. One
    // walk of the keys against the names the parse already collected — `for…in` rather than
    // `Object.keys`, because an href is built per row and the array would be garbage every time.
    if (params !== undefined) {
        for (const name in params) {
            const value = params[name]
            if (value === undefined || value === null) continue
            if (!pattern.names.includes(name)) {
                throw new Error(
                    `abide: url("${pattern.path}") was given "${name}", which is not a segment of it — pass it as the query argument instead`,
                )
            }
        }
    }
    return out === '' ? '/' : out
}
