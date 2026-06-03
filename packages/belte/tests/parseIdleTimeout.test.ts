import { describe, expect, test } from 'bun:test'
import { parseIdleTimeout } from '../src/lib/server/runtime/parseIdleTimeout.ts'

describe('parseIdleTimeout', () => {
    test('parses an in-range integer second count', () => {
        expect(parseIdleTimeout('30')).toBe(30)
        expect(parseIdleTimeout('0')).toBe(0)
        expect(parseIdleTimeout('255')).toBe(255)
    })

    test('returns undefined for missing or empty input so the caller keeps its default', () => {
        expect(parseIdleTimeout(undefined)).toBeUndefined()
        expect(parseIdleTimeout('')).toBeUndefined()
        expect(parseIdleTimeout('   ')).toBeUndefined()
    })

    test('rejects out-of-range and non-integer values rather than coercing them', () => {
        // Number('abc') is NaN, Number('') is 0, '256' exceeds Bun's max — all silently wrong.
        expect(parseIdleTimeout('abc')).toBeUndefined()
        expect(parseIdleTimeout('256')).toBeUndefined()
        expect(parseIdleTimeout('-1')).toBeUndefined()
        expect(parseIdleTimeout('1.5')).toBeUndefined()
    })
})
