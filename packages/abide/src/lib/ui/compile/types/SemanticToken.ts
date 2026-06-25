/*
A semantic-highlighting token in original `.abide` source coordinates. `type` and
`modifiers` are legend names (see ABIDE_SEMANTIC_TOKENS_LEGEND), resolved to wire
indices only at encode time.
*/
export type SemanticToken = {
    start: number
    length: number
    type: string
    modifiers: string[]
}
