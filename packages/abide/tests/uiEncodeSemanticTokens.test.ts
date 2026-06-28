import { describe, expect, test } from 'bun:test'
import { ABIDE_SEMANTIC_TOKENS_LEGEND } from '../src/lib/ui/compile/ABIDE_SEMANTIC_TOKENS_LEGEND.ts'
import { encodeSemanticTokens } from '../src/lib/ui/compile/encodeSemanticTokens.ts'

const KEYWORD = ABIDE_SEMANTIC_TOKENS_LEGEND.tokenTypes.indexOf('keyword')
const VARIABLE = ABIDE_SEMANTIC_TOKENS_LEGEND.tokenTypes.indexOf('variable')

describe('encodeSemanticTokens', () => {
    test('encodes a single token as relative deltas', () => {
        const text = `{#if a}`
        const data = encodeSemanticTokens(text, [
            { start: 2, length: 2, type: 'keyword', modifiers: [] },
        ])
        /* deltaLine 0, deltaChar 2, length 2, typeIndex KEYWORD, modifiers 0. */
        expect(data).toEqual([0, 2, 2, KEYWORD, 0])
    })

    test('sorts out-of-order tokens and encodes deltas between them', () => {
        const text = `a\n  bb`
        const data = encodeSemanticTokens(text, [
            { start: 4, length: 2, type: 'variable', modifiers: [] }, // line 1, char 2
            { start: 0, length: 1, type: 'keyword', modifiers: [] }, // line 0, char 0
        ])
        expect(data).toEqual([0, 0, 1, KEYWORD, 0, 1, 2, 2, VARIABLE, 0])
    })

    test('drops tokens whose type is not in the legend', () => {
        expect(
            encodeSemanticTokens(`x`, [{ start: 0, length: 1, type: 'bogus', modifiers: [] }]),
        ).toEqual([])
    })

    test('drops a token that overlaps the previous one', () => {
        const text = `abcd`
        const data = encodeSemanticTokens(text, [
            { start: 0, length: 3, type: 'keyword', modifiers: [] },
            { start: 1, length: 2, type: 'variable', modifiers: [] }, // overlaps → dropped
        ])
        expect(data).toEqual([0, 0, 3, KEYWORD, 0])
    })

    test('splits a token spanning newlines into one segment per line', () => {
        const STRING = ABIDE_SEMANTIC_TOKENS_LEGEND.tokenTypes.indexOf('string')
        /* A multiline template literal is one token in source coords; the LSP forbids
           a token crossing a line, so it must encode as a per-line segment stream. */
        const text = `ab\ncd`
        const data = encodeSemanticTokens(text, [
            { start: 0, length: 5, type: 'string', modifiers: [] },
        ])
        /* line 0 char 0 len 2 (`ab`); line 1 char 0 len 2 (`cd`). */
        expect(data).toEqual([0, 0, 2, STRING, 0, 1, 0, 2, STRING, 0])
    })

    test('drops the blank-line segment of a multiline token', () => {
        const STRING = ABIDE_SEMANTIC_TOKENS_LEGEND.tokenTypes.indexOf('string')
        const text = `a\n\nb`
        const data = encodeSemanticTokens(text, [
            { start: 0, length: 4, type: 'string', modifiers: [] },
        ])
        /* line 0 (`a`) and line 2 (`b`); the empty line 1 emits nothing. */
        expect(data).toEqual([0, 0, 1, STRING, 0, 2, 0, 1, STRING, 0])
    })

    test('sets the modifier bitset from legend modifier order', () => {
        const text = `x`
        const readonlyBit = 1 << ABIDE_SEMANTIC_TOKENS_LEGEND.tokenModifiers.indexOf('readonly')
        const data = encodeSemanticTokens(text, [
            { start: 0, length: 1, type: 'variable', modifiers: ['readonly'] },
        ])
        expect(data[4]).toBe(readonlyBit)
    })
})
