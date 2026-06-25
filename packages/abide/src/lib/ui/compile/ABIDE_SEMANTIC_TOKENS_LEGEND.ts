/*
The LSP semantic-tokens legend abide lsp advertises, and the decoder from
TypeScript's encoded classifications to legend names. TypeScript encodes a
classification as `((tokenType + 1) << 8) + modifierBitset`; its TokenType and
TokenModifier enums fix the orders below. `keyword`/`operator` carry the `{#…}`
block framing the structural tokenizer emits.
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

export const ABIDE_SEMANTIC_TOKENS_LEGEND = {
    tokenTypes: [...TS_TYPE_TO_LSP, 'keyword', 'operator'],
    tokenModifiers: TS_MODIFIERS,
}

/* Decodes one TypeScript encoded classification into legend names. */
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
