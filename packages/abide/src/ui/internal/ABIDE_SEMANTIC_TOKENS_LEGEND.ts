// The LSP semantic-tokens legend `abide lsp` advertises for `.abide` documents. The order is the
// wire contract: a token's `tokenType` field is an INDEX into `tokenTypes`, so this array must stay
// in sync with the encoder and never be reordered without re-encoding. `tokenModifiers` is empty —
// the markup pass emits no modifiers (Shape 1). Custom types (`tag`, `attribute`) are mapped to
// theme styles editor-side via `semantic_token_rules`; the rest are standard LSP token types.
export const ABIDE_SEMANTIC_TOKENS_LEGEND = {
    tokenTypes: ['tag', 'type', 'attribute', 'string', 'comment', 'keyword', 'operator', 'number'],
    tokenModifiers: [] as string[],
}
