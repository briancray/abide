import { describe, expect, test } from 'bun:test'
import {
    ABIDE_SEMANTIC_TOKENS_LEGEND,
    mapTsClassification,
} from '../src/lib/ui/compile/ABIDE_SEMANTIC_TOKENS_LEGEND.ts'

/* TS encodes a classification as ((tokenType + 1) << 8) + modifierBitset. */
const encode = (tokenType: number, modifiers: number): number => ((tokenType + 1) << 8) + modifiers

describe('mapTsClassification', () => {
    test('decodes a variable declaration', () => {
        /* TokenType.variable = 7, TokenModifier.declaration = bit 0. */
        expect(mapTsClassification(encode(7, 1 << 0))).toEqual({
            type: 'variable',
            modifiers: ['declaration'],
        })
    })

    test('decodes a readonly property with no modifiers collision', () => {
        /* TokenType.property = 9, TokenModifier.readonly = bit 3. */
        expect(mapTsClassification(encode(9, 1 << 3))).toEqual({
            type: 'property',
            modifiers: ['readonly'],
        })
    })

    test('maps TokenType.member to method', () => {
        /* TokenType.member = 11. */
        expect(mapTsClassification(encode(11, 0))).toEqual({ type: 'method', modifiers: [] })
    })

    test('returns undefined for an out-of-range type', () => {
        expect(mapTsClassification(encode(99, 0))).toBeUndefined()
    })

    test('legend lists every mapped type and keyword/operator for framing', () => {
        for (const type of ['variable', 'property', 'method', 'function', 'type', 'parameter']) {
            expect(ABIDE_SEMANTIC_TOKENS_LEGEND.tokenTypes).toContain(type)
        }
        expect(ABIDE_SEMANTIC_TOKENS_LEGEND.tokenTypes).toContain('keyword')
        expect(ABIDE_SEMANTIC_TOKENS_LEGEND.tokenTypes).toContain('operator')
    })
})
