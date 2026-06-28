import { describe, expect, test } from 'bun:test'
import ts from 'typescript'
import {
    ABIDE_SEMANTIC_TOKENS_LEGEND,
    mapSyntacticClassification,
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

describe('mapSyntacticClassification', () => {
    test('maps string/number/regex literal classifications to literal legend types', () => {
        expect(mapSyntacticClassification(ts.ClassificationType.stringLiteral)).toBe('string')
        expect(mapSyntacticClassification(ts.ClassificationType.numericLiteral)).toBe('number')
        expect(mapSyntacticClassification(ts.ClassificationType.bigintLiteral)).toBe('number')
        expect(mapSyntacticClassification(ts.ClassificationType.regularExpressionLiteral)).toBe(
            'regexp',
        )
    })

    test('ignores classifications the semantic pass owns (identifier, keyword)', () => {
        expect(mapSyntacticClassification(ts.ClassificationType.identifier)).toBeUndefined()
        expect(mapSyntacticClassification(ts.ClassificationType.keyword)).toBeUndefined()
    })

    test('the literal legend types are advertised', () => {
        for (const type of ['string', 'number', 'regexp']) {
            expect(ABIDE_SEMANTIC_TOKENS_LEGEND.tokenTypes).toContain(type)
        }
    })
})
