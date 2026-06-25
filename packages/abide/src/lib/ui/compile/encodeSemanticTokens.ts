import { ABIDE_SEMANTIC_TOKENS_LEGEND } from './ABIDE_SEMANTIC_TOKENS_LEGEND.ts'
import { offsetToPosition } from './offsetToPosition.ts'
import type { SemanticToken } from './types/SemanticToken.ts'

/*
Encodes source-coordinate tokens into the LSP semantic-tokens `data` array: five
integers per token (deltaLine, deltaStartChar, length, tokenTypeIndex,
modifierBitset), each position relative to the previous token. Tokens are sorted
by start; tokens with an unknown legend type, and any token overlapping the one
before it, are dropped — the protocol requires a strictly non-overlapping,
positionally-ordered stream.
*/
export function encodeSemanticTokens(text: string, tokens: SemanticToken[]): number[] {
    const sorted = [...tokens].sort((a, b) => a.start - b.start || a.length - b.length)
    const data: number[] = []
    let previousLine = 0
    let previousCharacter = 0
    let previousEnd = -1
    for (const token of sorted) {
        const typeIndex = ABIDE_SEMANTIC_TOKENS_LEGEND.tokenTypes.indexOf(token.type)
        if (typeIndex < 0 || token.start < previousEnd) {
            continue
        }
        const modifierBitset = token.modifiers.reduce((bits, name) => {
            const bit = ABIDE_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf(name)
            return bit < 0 ? bits : bits | (1 << bit)
        }, 0)
        const { line, character } = offsetToPosition(text, token.start)
        const deltaLine = line - previousLine
        const deltaCharacter = deltaLine === 0 ? character - previousCharacter : character
        data.push(deltaLine, deltaCharacter, token.length, typeIndex, modifierBitset)
        previousLine = line
        previousCharacter = character
        previousEnd = token.start + token.length
    }
    return data
}
