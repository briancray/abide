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

        // Advance the generated position over the text just copied.
        for (const character of text) {
            if (character === '\n') {
                line++
                column = 0
            } else {
                column++
            }
        }

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

export function startsOf(source: string): number[] {
    const starts = [0]
    for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1)
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
        // Keep the offset INTO the expression, so a diagnostic lands on the right token and not
        // merely on the right expression.
        column: best.originalColumn + (generatedColumn - best.generatedColumn) + 1,
    }
}
