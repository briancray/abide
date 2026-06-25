import type { SemanticToken } from './types/SemanticToken.ts'

/*
Lexical highlighting for `{#…}`/`{:…}`/`{/…}` control-flow framing — the part the
HTML grammar sees only as text and the shadow program lowers away. A pure scan of
raw source (independent of a successful parse, so it survives mid-edit), it emits
an `operator` token for the `{`+sigil opener and a `keyword` token for the block
word. Expression interiors (and the `{@const}`/`{@html}` tags and bare `{expr}`
interpolations) are NOT touched here — those are the shadow's job. A keyword
allowlist after the sigil prevents matching arbitrary `{:foo}` text. Longest
phrases first so `for await` beats `for` and `else if` beats `else`.
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
    return [...source.matchAll(BLOCK_HEAD)].flatMap((match) => {
        const braceStart = match.index
        const keyword = match[2]
        const keywordStart = braceStart + match[0].length - keyword.length
        return [
            { start: braceStart, length: 2, type: 'operator', modifiers: [] },
            { start: keywordStart, length: keyword.length, type: 'keyword', modifiers: [] },
        ]
    })
}
