// Where a position in the emitted module came from.
//
// The compiler copies every expression through verbatim, so a mapping only has to record WHERE each
// copy landed. That is done by writing an invisible marker in front of each one during emit and
// stripping the markers off the finished string — one pass, and no position bookkeeping threaded
// through every function that builds a fragment.
//
// The result is a standard v3 source map, so it serves both jobs at once: `abide check` moves a type
// error back onto the `.abide` line, and a runtime stack trace lands there too.

/** Private-use code points: they cannot occur in TypeScript that anyone meant to write. */
const MARK = '\uE000'
const MARK_END = '\uE001'

/** Tag emitted text with the offset in the `.abide` file it was copied from. */
export function mark(start: number, text: string): string {
    return `${MARK}${start}${MARK_END}${text}`
}

export interface Segment {
    generatedLine: number
    generatedColumn: number
    originalLine: number
    originalColumn: number
}

/** Strip every marker and record where it ended up. */
export function extract(code: string, source: string): { code: string; segments: Segment[] } {
    if (!code.includes(MARK)) return { code, segments: [] }

    const lineStarts = startsOf(source)
    const segments: Segment[] = []
    let out = ''
    let line = 0
    let column = 0
    let at = 0

    for (;;) {
        const open = code.indexOf(MARK, at)
        if (open === -1) {
            out += code.slice(at)
            break
        }
        const close = code.indexOf(MARK_END, open)
        const text = code.slice(at, open)
        out += text

        // Advance the generated position over the text just copied. One forward `indexOf` walk, which
        // answers both halves at once — the common shape is a run with no newline at all, and that is
        // the first `indexOf` returning -1. Walking it as a string ITERATOR instead paid an
        // iterator-result object and a surrogate-pair decision per character of the whole emitted
        // module, to answer only "how many newlines, and how far past the last".
        let lastBreak = -1
        for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
            line++
            lastBreak = at
        }
        if (lastBreak < 0) column += text.length
        else column = text.length - lastBreak - 1

        const offset = Number(code.slice(open + 1, close))
        const position = positionAt(lineStarts, offset)
        segments.push({
            generatedLine: line,
            generatedColumn: column,
            originalLine: position.line,
            originalColumn: position.column,
        })
        at = close + 1
    }
    return { code: out, segments }
}

// The same forward `indexOf` walk `extract` above takes, and for the same reason: `source[i]`
// materialises a one-character string per byte of the whole `.abide` file to answer a question
// `indexOf` answers per LINE.
export function startsOf(source: string): number[] {
    const starts = [0]
    for (let at = source.indexOf('\n'); at !== -1; at = source.indexOf('\n', at + 1)) starts.push(at + 1)
    return starts
}

/** Zero-based line and column for an offset. A source map wants zero-based; a diagnostic adds one. */
export function positionAt(starts: number[], offset: number): { line: number; column: number } {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
        const middle = (low + high + 1) >> 1
        if ((starts[middle] as number) <= offset) low = middle
        else high = middle - 1
    }
    return { line: low, column: offset - (starts[low] as number) }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function vlq(value: number): string {
    // Sign in the low bit, five data bits per digit, continuation in the high bit.
    let rest = value < 0 ? (-value << 1) | 1 : value << 1
    let out = ''
    do {
        let digit = rest & 0b11111
        rest >>>= 5
        if (rest > 0) digit |= 0b100000
        out += ALPHABET[digit]
    } while (rest > 0)
    return out
}

/** A v3 source map with the original file inlined, so nothing has to resolve a path to read it. */
export function sourceMap(segments: Segment[], sourceName: string, source: string): string {
    const lines: string[] = []
    let previousGeneratedColumn = 0
    let previousOriginalLine = 0
    let previousOriginalColumn = 0
    let line = 0
    let current: string[] = []

    for (const segment of segments) {
        while (line < segment.generatedLine) {
            lines.push(current.join(','))
            current = []
            previousGeneratedColumn = 0
            line++
        }
        current.push(
            vlq(segment.generatedColumn - previousGeneratedColumn) +
                vlq(0) +
                vlq(segment.originalLine - previousOriginalLine) +
                vlq(segment.originalColumn - previousOriginalColumn),
        )
        previousGeneratedColumn = segment.generatedColumn
        previousOriginalLine = segment.originalLine
        previousOriginalColumn = segment.originalColumn
    }
    lines.push(current.join(','))

    return JSON.stringify({
        version: 3,
        sources: [sourceName],
        sourcesContent: [source],
        names: [],
        mappings: lines.join(';'),
    })
}

/**
 * The other direction: where a `.abide` position ENDED UP in the emitted module.
 *
 * `original` answers a diagnostic, which arrives from the checker and has to be shown on a page.
 * This answers a QUESTION, which starts on the page and has to be asked of the checker — a hover or
 * a go-to-definition is a cursor in the `.abide` file and nothing else, and the checker only knows
 * the module. Same segment list read the same way, so the two cannot disagree about where a mapping
 * begins; what they do not share is exactness, and it fails in the same direction for the same
 * reason. Within an expression the offset drifts by whatever the desugar inserted before that point,
 * so a cursor late in a long expression can land a character or two off in the module.
 *
 * That is survivable HERE in a way it is not for a squiggle: the checker is asked about a position
 * and answers about the node CONTAINING it, so a couple of characters of drift inside one identifier
 * is the same identifier. It stops being survivable at the identifier's edge, which is why a caller
 * that has a choice asks from inside a name rather than at its end.
 */
export function generated(
    segments: Segment[],
    originalLine: number,
    originalColumn: number,
): { line: number; column: number } | null {
    let best: Segment | null = null
    for (const segment of segments) {
        if (segment.originalLine !== originalLine) continue
        if (segment.originalColumn > originalColumn) continue
        if (best === null || segment.originalColumn > best.originalColumn) best = segment
    }
    if (best === null) return null
    return {
        line: best.generatedLine,
        column: best.generatedColumn + (originalColumn - best.originalColumn),
    }
}

/**
 * The `.abide` position a generated one came from — the nearest mapping at or before it on the same
 * line, which is what a diagnostic inside a copied expression needs.
 *
 * The LINE is exact. The column is exact at the start of an expression and drifts within one by
 * however much the desugar inserted before that point (`x` -> `x()` is two characters), so it points
 * into the offending expression rather than precisely at the offending token. Making it exact means a
 * mapping per rewrite rather than per expression — the `Edit` list `apply` consumes would carry it,
 * if `desugar` returned it rather than the reads.
 */
export function original(
    segments: Segment[],
    generatedLine: number,
    generatedColumn: number,
): { line: number; column: number } | null {
    let best: Segment | null = null
    for (const segment of segments) {
        if (segment.generatedLine !== generatedLine) continue
        if (segment.generatedColumn > generatedColumn) continue
        if (best === null || segment.generatedColumn > best.generatedColumn) best = segment
    }
    if (best === null) return null
    return {
        line: best.originalLine + 1,
        // The offset from the expression's START, uncorrected for what the desugar inserted before
        // this point — which is the drift the docblock above describes.
        column: best.originalColumn + (generatedColumn - best.generatedColumn) + 1,
    }
}
