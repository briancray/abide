import { ABIDE_SEMANTIC_TOKENS_LEGEND } from './ABIDE_SEMANTIC_TOKENS_LEGEND.ts'
import type { TemplateToken } from './ast.ts'

// Encode source-coordinate tokens into the LSP semantic-tokens `data` array: five integers per
// token (deltaLine, deltaStartChar, length, tokenTypeIndex, modifierBitset), each position relative
// to the previous emitted token. The protocol requires a strictly ordered, non-overlapping stream
// that never crosses a line — so we split multi-line spans per line, sort by start, and drop any
// token overlapping the one before it or carrying an unknown legend type.

const TYPE_INDEX = new Map(
    ABIDE_SEMANTIC_TOKENS_LEGEND.tokenTypes.map((name, index) => [name, index] as const),
)

// A token may cover a multi-line span (a comment, or a quoted value with newlines). The protocol
// forbids a token crossing a line, so split it into one segment per covered line, dropping the empty
// stretches. A single-line token returns unchanged.
function splitByLine(source: string, token: TemplateToken): TemplateToken[] {
    const raw = source.slice(token.start, token.start + token.length)
    const newline = raw.indexOf('\n')
    if (newline === -1) return [token]
    const segments: TemplateToken[] = []
    let offset = token.start
    for (const line of raw.split('\n')) {
        if (line.length > 0) segments.push({ start: offset, length: line.length, type: token.type })
        offset += line.length + 1 // + the consumed `\n`
    }
    return segments
}

export function encodeSemanticTokens(source: string, tokens: TemplateToken[]): number[] {
    const segments: TemplateToken[] = []
    for (const token of tokens) {
        for (const segment of splitByLine(source, token)) segments.push(segment)
    }
    segments.sort((a, b) => a.start - b.start || a.length - b.length)

    const data: number[] = []
    // Single forward cursor over the source: line/character of the previous token, advanced to each
    // token's start (tokens are sorted, so the cursor never rewinds) — O(n) rather than O(n) per token.
    let cursorOffset = 0
    let cursorLine = 0
    let cursorCharacter = 0
    let previousLine = 0
    let previousCharacter = 0
    let previousEnd = -1

    for (const segment of segments) {
        const typeIndex = TYPE_INDEX.get(segment.type)
        if (typeIndex === undefined || segment.start < previousEnd) continue

        while (cursorOffset < segment.start) {
            if (source.charCodeAt(cursorOffset) === 10) {
                cursorLine++
                cursorCharacter = 0
            } else {
                cursorCharacter++
            }
            cursorOffset++
        }

        const deltaLine = cursorLine - previousLine
        const deltaCharacter =
            deltaLine === 0 ? cursorCharacter - previousCharacter : cursorCharacter
        data.push(deltaLine, deltaCharacter, segment.length, typeIndex, 0)
        previousLine = cursorLine
        previousCharacter = cursorCharacter
        previousEnd = segment.start + segment.length
    }
    return data
}
