import { describe, expect, test } from 'bun:test'
import { detectVerbMethod } from '../src/lib/shared/detectVerbMethod.ts'

describe('detectVerbMethod', () => {
    test('reads the verb from the export convention', () => {
        expect(detectVerbMethod('export const getHello = GET(() => json({}))')).toBe('GET')
        expect(detectVerbMethod('export const make = POST(handler)')).toBe('POST')
        expect(detectVerbMethod('export const drop = DELETE(handler)')).toBe('DELETE')
    })

    test('reads through an explicit args generic', () => {
        expect(detectVerbMethod('export const find = GET<{ id: string }>(handler)')).toBe('GET')
    })

    test('ignores incidental verb mentions outside the export', () => {
        // A handler that calls fetch or names a verb in a comment must not be read as the method.
        const source = `// uses GET semantics\nexport const make = POST(() => fetch('/x'))`
        expect(detectVerbMethod(source)).toBe('POST')
    })

    test('returns undefined when no verb export matches', () => {
        expect(detectVerbMethod('export const helper = () => 1')).toBeUndefined()
        expect(detectVerbMethod('')).toBeUndefined()
    })
})
