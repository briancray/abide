// One scanner over JavaScript source, with two consumers that used to be two scanners.
//
// The page shows a case's body, and the body has to be FOUND before it can be shown: the server
// slices it out of the demo file, the browser colours what came back. Both questions are answered by
// where the strings, comments, regexes and template literals are — so there is one pass here that
// records spans and brace depth, and the two callers read the same spans for different reasons.
//
// Hand-written rather than TypeScript's scanner, which the compiler next door uses: this reads
// authored demo bodies, and pulling ~700 kB of `typescript/unstable/ast` into the browser to colour a
// `<pre>` is a bundle that costs more than the feature. The grammar it has to cover is the subset a
// demo body is written in, and the round-trip test in `test/site.test.ts` is what says it covers it —
// every character back in order, or the pane is showing code nobody wrote.
//
// Template literals get a STACK rather than a flag: `html` bodies nest one inside another's `${}`,
// and a flag colours everything after the inner backtick as string.

/** What a span is coloured as. The empty name is plain text — whitespace, and identifiers. */
export type Ink = 'comment' | 'string' | 'regex' | 'number' | 'keyword' | 'literal' | 'call' | 'punct' | ''

export interface Span {
    ink: Ink
    start: number
    end: number
    /** Brace depth AFTER this span, so the `}` that closes depth 1 reports 0. */
    depth: number
}

/** The Tailwind ramp each ink is painted in. One place, so a card and a pane cannot disagree. */
export const INK_COLOR: Record<Ink, string> = {
    comment: 'tok-comment',
    string: 'tok-string',
    regex: 'tok-regex',
    number: 'tok-number',
    keyword: 'tok-keyword',
    literal: 'tok-literal',
    call: 'tok-call',
    punct: 'tok-punct',
    '': '',
}

// Written as split lists rather than array literals so a word costs a word rather than a line.
const KEYWORDS = new Set(
    (
        'as async await break case catch class const continue default delete do else export extends ' +
        'finally for from function get if import in instanceof interface let new of return ' +
        'satisfies set static switch throw try type typeof var void while yield'
    ).split(' '),
)

const LITERALS = new Set('false Infinity NaN null this true undefined'.split(' '))

/** A `/` after one of these opens a regex; after anything else it divides. */
const BEFORE_REGEX = new Set(
    'await case delete do else in instanceof new of return typeof void yield'.split(' '),
)

/** `)` and `]` are the ones deliberately absent: `(a + b) / 2` and `xs[i] / 2` are divides. */
const PUNCT_BEFORE_REGEX = new Set('(,=:[!&|?{};+-*%<>~^'.split(''))

function isSpace(ch: string): boolean {
    return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r'
}

function isWordStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$'
}

function isWord(ch: string): boolean {
    return isWordStart(ch) || (ch >= '0' && ch <= '9')
}

/**
 * Every span in `source`, in order, covering it completely — so joining their text is the input back.
 *
 * One pass, and it is the only pass: a second scanner over the same grammar is the failure this file
 * exists to prevent, because the two disagree about exactly the cases that are hard (a regex against a
 * divide, a `}` closing a block against one resuming a template).
 */
export function scan(source: string): Span[] {
    const spans: Span[] = []
    let braceDepth = 0
    const push = (ink: Ink, start: number, end: number): void => {
        if (end > start) spans.push({ ink, start, end, depth: braceDepth })
    }

    /** One record per open template: the brace depth its `${` sits at. */
    const open: number[] = []
    let inTemplateText = false
    let previous = '' // last significant token, to tell a regex from a divide
    let i = 0
    const n = source.length

    while (i < n) {
        const ch = source[i] as string

        // the literal halves of a template, up to `${` or the closing backtick
        if (inTemplateText) {
            let j = i
            while (j < n) {
                const c = source[j] as string
                if (c === '\\') {
                    j += 2
                    continue
                }
                if (c === '`' || (c === '$' && source[j + 1] === '{')) break
                j++
            }
            if (j < n && source[j] === '`') {
                push('string', i, j + 1)
                open.pop()
                inTemplateText = false
                previous = '`'
                i = j + 1
            } else if (j < n) {
                push('string', i, j)
                braceDepth++
                push('punct', j, j + 2)
                inTemplateText = false
                previous = '{'
                i = j + 2
            } else {
                push('string', i, n)
                i = n
            }
            continue
        }

        if (isSpace(ch)) {
            let j = i + 1
            while (j < n && isSpace(source[j] as string)) j++
            push('', i, j)
            i = j
            continue
        }

        if (ch === '/' && source[i + 1] === '/') {
            let j = i + 2
            while (j < n && source[j] !== '\n') j++
            push('comment', i, j)
            i = j
            continue
        }

        if (ch === '/' && source[i + 1] === '*') {
            const end = source.indexOf('*/', i + 2)
            const j = end === -1 ? n : end + 2
            push('comment', i, j)
            i = j
            continue
        }

        if (ch === '"' || ch === "'") {
            let j = i + 1
            while (j < n && source[j] !== ch) j += source[j] === '\\' ? 2 : 1
            j = j < n ? j + 1 : n
            push('string', i, j)
            previous = '"'
            i = j
            continue
        }

        if (ch === '`') {
            open.push(braceDepth)
            push('string', i, i + 1)
            inTemplateText = true
            i++
            continue
        }

        // a regex only where an expression can start — a character class holds `/` and quotes, so
        // reading `/[&<>"']/g` as a divide starts a string that never closes
        if (
            ch === '/' &&
            (previous === '' || BEFORE_REGEX.has(previous) || PUNCT_BEFORE_REGEX.has(previous))
        ) {
            let j = i + 1
            let inClass = false
            while (j < n) {
                const c = source[j] as string
                if (c === '\\') {
                    j += 2
                    continue
                }
                if (c === '\n') break
                if (c === '[') inClass = true
                else if (c === ']') inClass = false
                else if (c === '/' && !inClass) break
                j++
            }
            if (j < n && source[j] === '/') {
                j++
                while (j < n && isWord(source[j] as string)) j++
                push('regex', i, j)
                previous = '/re/'
                i = j
                continue
            }
        }

        if (ch >= '0' && ch <= '9') {
            let j = i + 1
            while (j < n && (isWord(source[j] as string) || source[j] === '.')) j++
            push('number', i, j)
            previous = '0'
            i = j
            continue
        }

        if (isWordStart(ch)) {
            let j = i + 1
            while (j < n && isWord(source[j] as string)) j++
            const word = source.slice(i, j)
            let after = j
            while (after < n && isSpace(source[after] as string)) after++
            let ink: Ink = ''
            if (KEYWORDS.has(word) && previous !== '.') ink = 'keyword'
            else if (LITERALS.has(word) && previous !== '.') ink = 'literal'
            else if (source[after] === '(') ink = 'call'
            push(ink, i, j)
            previous = word
            i = j
            continue
        }

        if (ch === '{') braceDepth++
        else if (ch === '}') {
            braceDepth--
            // The `}` that closes a `${` resumes the template it interrupted rather than closing a
            // block, which is the one place depth alone cannot say what a brace meant.
            if (open.length > 0 && (open[open.length - 1] as number) === braceDepth) {
                push('punct', i, i + 1)
                inTemplateText = true
                previous = '}'
                i++
                continue
            }
        }
        push('punct', i, i + 1)
        previous = ch
        i++
    }

    return spans
}

/** A span with its text and its class, which is all a template needs to paint one. */
export interface Painted {
    class: string
    text: string
}

/**
 * `source` as spans a template can render — one `<span>` per RUN of a colour, escaped by the renderer.
 *
 * Adjacent tokens that paint the same are one span, because `scan` emits a token and the pane renders
 * an element: `({ is, log })` is six punctuation tokens and would be six `<span>`s plus six text nodes
 * for one colour. Merged by CLASS rather than by ink, so `number` and `literal` — the same amber —
 * collapse too. Nothing is lost: a pane is built once on open and never re-renders, so there is no
 * per-token identity for a reconcile to keep.
 */
export function painted(source: string): Painted[] {
    const out: Painted[] = []
    let ink = ''
    let from = 0
    let to = -1
    for (const span of scan(source)) {
        const painting = INK_COLOR[span.ink]
        if (to === span.start && painting === ink) {
            to = span.end
            continue
        }
        if (to !== -1) out.push({ class: ink, text: source.slice(from, to) })
        ink = painting
        from = span.start
        to = span.end
    }
    if (to !== -1) out.push({ class: ink, text: source.slice(from, to) })
    return out
}

/** The faces of a case that have a body worth showing. */
export type Face = 'run' | 'server' | 'interact'

/**
 * The text of one case's `run`, `server` or `interact`, exactly as it is written in `source`.
 *
 * Found by the case's TITLE, which is the one thing about a case that is unique within its suite and
 * is already how the page names it. From there it is the next face at the depth the title itself sits
 * at — the case's own object — so a `run` nested inside an earlier case's body cannot be mistaken for
 * the next case's. The face is matched as the IDENTIFIER it is written as, which is why a fourth one
 * needed nothing here beyond its name in the union.
 *
 * `null` when the suite does not say what the runtime says it does, which is a demo file edited into
 * disagreement with itself rather than a request to refuse.
 *
 * `scanned` is the same file's spans from a previous slice. Every call needs the WHOLE file scanned
 * to find one body, so a caller slicing several cases out of one file — which is what a page of cards
 * asks for — hands the scan back rather than paying for it per case.
 */
export function sliceOf(source: string, title: string, face: Face, scanned?: Span[]): string | null {
    const spans = scanned ?? scan(source)

    let at = -1
    for (let i = 0; i < spans.length; i++) {
        const span = spans[i] as Span
        if (span.ink !== 'string') continue
        // The quotes are the first and last character of the span, and the demo files are Biome's
        // single-quoted output — so an apostrophe inside a title is escaped and compared as written.
        if (source.slice(span.start + 1, span.end - 1).replace(/\\'/g, "'") === title) {
            at = i
            break
        }
    }
    if (at === -1) return null

    const depth = (spans[at] as Span).depth
    for (let i = at + 1; i < spans.length; i++) {
        const span = spans[i] as Span
        // Out of the case's own object: the next `run` belongs to the next case, and a case that does
        // not have this face has to answer nothing rather than answer with its neighbour's body.
        if (span.depth < depth) return null
        if (span.depth !== depth || span.ink === 'string' || span.ink === 'comment') continue
        if (source.slice(span.start, span.end) !== face) continue

        // `async run(…)` — the word before it belongs to the body being shown.
        let start = span.start
        const before = spans[i - 1]
        const earlier = spans[i - 2]
        if (
            before?.ink === '' &&
            earlier !== undefined &&
            source.slice(earlier.start, earlier.end) === 'async'
        ) {
            start = earlier.start
        }
        // The BODY's brace, which is the first one OUTSIDE the parameter list. `run({ is, log }) {`
        // opens a brace before it that closes back to the same depth, so a scan that took the first
        // `}` at `depth` stopped at the end of the parameters and served that as the whole case.
        let parens = 0
        let body = -1
        for (let j = i + 1; j < spans.length; j++) {
            const one = spans[j] as Span
            if (one.ink !== 'punct') continue
            const char = source[one.start]
            if (char === '(') parens++
            else if (char === ')') parens--
            else if (char === '{' && parens === 0) {
                body = j
                break
            }
        }
        if (body === -1) return null

        // The body's `{` takes depth to `depth + 1`; the `}` that reports `depth` again is its close.
        for (let j = body + 1; j < spans.length; j++) {
            const end = spans[j] as Span
            if (end.ink === 'punct' && source[end.start] === '}' && end.depth === depth) {
                return source.slice(start, end.end)
            }
        }
        return null
    }
    return null
}
