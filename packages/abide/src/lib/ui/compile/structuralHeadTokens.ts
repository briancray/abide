import { BLOCK_CONNECTORS, BLOCK_OPENERS } from './BLOCK_KEYWORDS.ts'
import type { SemanticToken } from './types/SemanticToken.ts'

/*
Semantic tokens for a `{#…}`/`{:…}`/`{/…}` control-block head, driven by the parse
walk (`readBlockToken`) rather than a raw source regex — so the SAME grammar that
builds the block tree colors it, and a `{#for}` sitting inside a `{expr}`/string/
backtick region (which the walk skips as opaque expression text) is never miscolored.
Emits an `operator` token for the `{`+sigil opener and a `keyword` token for the
block word, plus the `of`/`by` connectors inside a `{#for …}` head. A keyword
allowlist after the sigil keeps an arbitrary `{:foo}` uncolored (nothing emitted).
*/
/* The scan vocabulary, derived from the shared BLOCK_KEYWORDS source of truth (plus the
   `for await` async-each phrase) so it can't drift from the parser. Sorted longest-first so
   the match takes the whole phrase — `for await` beats `for`, `else if` beats `else` —
   since a shorter prefix checked first would win otherwise. */
const BLOCK_KEYWORDS = [...BLOCK_OPENERS, ...BLOCK_CONNECTORS, 'for await'].sort(
    (a, b) => b.length - a.length,
)

const WORD_CHAR = /\w/

/*
Emits the head tokens for a block whose `{` sits at `braceStart`, whose sigil is
`#`/`:`/`/`, and whose first directive word begins at `keywordStart` (already past the
leading whitespace `{#  for}` allows). Matches the longest allowlist keyword at
`keywordStart` requiring a trailing word boundary; if no keyword matches, emits NOTHING
(not even the opener) — mirroring the old regex, which only colored an allowlist match.
*/
export function structuralHeadTokens(
    source: string,
    braceStart: number,
    sigil: string,
    keywordStart: number,
): SemanticToken[] {
    let matched: string | undefined
    for (const keyword of BLOCK_KEYWORDS) {
        if (
            source.startsWith(keyword, keywordStart) &&
            !WORD_CHAR.test(source.charAt(keywordStart + keyword.length))
        ) {
            matched = keyword
            break
        }
    }
    if (matched === undefined) {
        return []
    }
    const tokens: SemanticToken[] = [
        { start: braceStart, length: 2, type: 'operator', modifiers: [] },
        { start: keywordStart, length: matched.length, type: 'keyword', modifiers: [] },
    ]
    /* A `{#for …}` head carries abide-only connectors `of`/`by` that the shadow lowers
       away (`of`) or never emits (`by`), so color them here. */
    if (sigil === '#' && (matched === 'for' || matched === 'for await')) {
        forHeadConnectors(source, keywordStart + matched.length, tokens)
    }
    return tokens
}

/*
Scans a `{#for …}` head from `from` to its closing `}`, pushing `keyword` tokens for the
`of`/`by` connectors at brace depth 0 — skipping any `of`/`by` nested in a destructure,
call, or string so an identifier or object key is never miscolored.
*/
function forHeadConnectors(source: string, from: number, tokens: SemanticToken[]): void {
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
}
