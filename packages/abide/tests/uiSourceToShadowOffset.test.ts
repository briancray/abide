import { describe, expect, test } from 'bun:test'
import { sourceToShadowOffset } from '../src/lib/ui/compile/sourceToShadowOffset.ts'
import type { ShadowMapping } from '../src/lib/ui/compile/types/CompiledShadow.ts'

const MAPPINGS: ShadowMapping[] = [
    { shadowStart: 100, sourceStart: 10, length: 5 },
    { shadowStart: 200, sourceStart: 40, length: 3 },
]

describe('sourceToShadowOffset', () => {
    test('shifts an offset inside a mapped span into shadow coordinates', () => {
        expect(sourceToShadowOffset(MAPPINGS, 12)).toBe(102)
        expect(sourceToShadowOffset(MAPPINGS, 41)).toBe(201)
    })

    test('maps the first character of a span (inclusive start)', () => {
        expect(sourceToShadowOffset(MAPPINGS, 10)).toBe(100)
    })

    test('an offset outside every mapped span has no shadow position', () => {
        expect(sourceToShadowOffset(MAPPINGS, 9)).toBeUndefined()
        /* The end is exclusive: offset 15 is one past the first span. */
        expect(sourceToShadowOffset(MAPPINGS, 15)).toBeUndefined()
    })

    test('is the inverse of the diagnostic remap on a mapped offset', () => {
        const sourceOffset = 42
        const shadowOffset = sourceToShadowOffset(MAPPINGS, sourceOffset)!
        const mapping = MAPPINGS[1]!
        expect(mapping.sourceStart + (shadowOffset - mapping.shadowStart)).toBe(sourceOffset)
    })
})
