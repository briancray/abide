import ts from 'typescript'

/*
The LSP semantic-tokens legend abide lsp advertises, and the decoders from
TypeScript's encoded classifications to legend names. TypeScript encodes a
*semantic* classification as `((tokenType + 1) << 8) + modifierBitset`; its
TokenType and TokenModifier enums fix the orders below. `keyword`/`operator` carry
the `{#…}` block framing the structural tokenizer emits; `string`/`number`/`regexp`
carry the literal *syntactic* classifications the semantic classifier never reports
(so a template-literal string inside `{…}` gets string coloring); `tag`/`attribute`/
`comment` carry the HTML markup structure the markup tokenizer emits, so the LSP
owns element/attribute/comment coloring instead of leaning on tree-sitter (which
desyncs on abide's `attr={expr}` values).
*/

/* TS TokenType order (class=0 … member=11) → LSP token-type name. */
const TS_TYPE_TO_LSP = [
    'class',
    'enum',
    'interface',
    'namespace',
    'typeParameter',
    'type',
    'parameter',
    'variable',
    'enumMember',
    'property',
    'function',
    'method',
]

/* TS TokenModifier order (declaration=bit 0 … local=bit 5). */
const TS_MODIFIERS = ['declaration', 'static', 'async', 'readonly', 'defaultLibrary', 'local']

/* TS syntactic `ClassificationType` (legacy direct enum value) → literal legend
   type. Only the literals the semantic classifier omits; identifiers, keywords, and
   punctuation are left to the semantic pass (or untouched). */
const SYNTACTIC_LITERAL_TO_LSP: Partial<Record<ts.ClassificationType, string>> = {
    [ts.ClassificationType.stringLiteral]: 'string',
    [ts.ClassificationType.numericLiteral]: 'number',
    [ts.ClassificationType.bigintLiteral]: 'number',
    [ts.ClassificationType.regularExpressionLiteral]: 'regexp',
}

export const ABIDE_SEMANTIC_TOKENS_LEGEND = {
    tokenTypes: [
        ...TS_TYPE_TO_LSP,
        'keyword',
        'operator',
        'string',
        'number',
        'regexp',
        'tag',
        'attribute',
        'comment',
    ],
    tokenModifiers: TS_MODIFIERS,
}

/* Decodes one TypeScript encoded *semantic* classification into legend names. */
export function mapTsClassification(
    classification: number,
): { type: string; modifiers: string[] } | undefined {
    const tokenType = (classification >> 8) - 1
    const type = TS_TYPE_TO_LSP[tokenType]
    if (type === undefined) {
        return undefined
    }
    const modifierSet = classification & 255
    const modifiers = TS_MODIFIERS.filter((_, bit) => (modifierSet & (1 << bit)) !== 0)
    return { type, modifiers }
}

/* Decodes one TypeScript *syntactic* classification (the legacy direct enum value,
   not the bit-shifted semantic form) into a literal legend type, or undefined for
   classifications the semantic pass already covers. */
export function mapSyntacticClassification(classification: number): string | undefined {
    return SYNTACTIC_LITERAL_TO_LSP[classification as ts.ClassificationType]
}
