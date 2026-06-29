import type { SemanticToken } from './types/SemanticToken.ts'

/*
Lexical highlighting for `{#…}`/`{:…}`/`{/…}` control-flow framing — the part the
HTML grammar sees only as text and the shadow program lowers away. A pure scan of
raw source (independent of a successful parse, so it survives mid-edit), it emits
an `operator` token for the `{`+sigil opener and a `keyword` token for the block
word, plus the `of`/`by` connectors inside a `{#for …}` head. Expression interiors
and bare `{expr}` interpolations are NOT touched here — those are the shadow's job.
A keyword allowlist after the sigil prevents matching arbitrary `{:foo}` text.
Longest phrases first so `for await` beats `for` and `else if` beats `else`.
*/
const BLOCK_KEYWORDS = [
    'for await',
    'else if',
    'if',
    'for',
    'await',
    'switch',
    'case',
    'default',
    'try',
    'catch',
    'finally',
    'then',
    'else',
]

const BLOCK_HEAD = new RegExp(`\\{([#:/])\\s*(${BLOCK_KEYWORDS.join('|')})\\b`, 'g')

export function structuralBlockTokens(source: string): SemanticToken[] {
    const tokens: SemanticToken[] = []
    for (const match of source.matchAll(BLOCK_HEAD)) {
        const braceStart = match.index
        const sigil = match[1]
        const keyword = match[2]
        if (keyword === undefined) {
            continue
        }
        const keywordStart = braceStart + match[0].length - keyword.length
        tokens.push({ start: braceStart, length: 2, type: 'operator', modifiers: [] })
        tokens.push({ start: keywordStart, length: keyword.length, type: 'keyword', modifiers: [] })
        /* A `{#for …}` head carries abide-only connectors `of`/`by` that the shadow
           lowers away (`of`) or never emits (`by`), so color them here. */
        if (sigil === '#' && (keyword === 'for' || keyword === 'for await')) {
            tokens.push(...forHeadConnectors(source, keywordStart + keyword.length))
        }
    }
    return tokens
}

/*
Scans a `{#for …}` head from `from` to its closing `}`, emitting `keyword` tokens
for the `of`/`by` connectors at brace depth 0 — skipping any `of`/`by` nested in a
destructure, call, or string so an identifier or object key is never miscolored.
*/
function forHeadConnectors(source: string, from: number): SemanticToken[] {
    const tokens: SemanticToken[] = []
    let depth = 0
    let cursor = from
    while (cursor < source.length) {
        const char = source.charAt(cursor)
        if (char === '"' || char === "'" || char === '`') {
            cursor += 1
            while (cursor < source.length && source.charAt(cursor) !== char) {
                if (source.charAt(cursor) === '\\') {
                    cursor += 1
                }
                cursor += 1
            }
        } else if (char === '{' || char === '(' || char === '[') {
            depth += 1
        } else if (char === ')' || char === ']') {
            depth -= 1
        } else if (char === '}') {
            if (depth === 0) {
                break
            }
            depth -= 1
        } else if (depth === 0 && (char === 'o' || char === 'b')) {
            const word = source.startsWith('of', cursor)
                ? 'of'
                : source.startsWith('by', cursor)
                  ? 'by'
                  : undefined
            const isWordBoundary = (offset: number): boolean => /\s/.test(source.charAt(offset))
            if (
                word !== undefined &&
                isWordBoundary(cursor - 1) &&
                isWordBoundary(cursor + word.length)
            ) {
                tokens.push({ start: cursor, length: word.length, type: 'keyword', modifiers: [] })
                cursor += word.length
                continue
            }
        }
        cursor += 1
    }
    return tokens
}
