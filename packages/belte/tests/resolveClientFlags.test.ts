import { describe, expect, test } from 'bun:test'
import { isReadOnlyMethod } from '../src/lib/shared/isReadOnlyMethod.ts'
import { resolveClientFlags } from '../src/lib/shared/resolveClientFlags.ts'

describe('isReadOnlyMethod', () => {
    test('GET and HEAD are read-only', () => {
        expect(isReadOnlyMethod('GET')).toBe(true)
        expect(isReadOnlyMethod('HEAD')).toBe(true)
    })
    test('mutating verbs are not', () => {
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
            expect(isReadOnlyMethod(method)).toBe(false)
        }
    })
})

describe('resolveClientFlags', () => {
    test('browser defaults on; mcp/cli take the supplied defaults', () => {
        expect(resolveClientFlags(undefined, { mcp: true, cli: true })).toEqual({
            browser: true,
            mcp: true,
            cli: true,
        })
        expect(resolveClientFlags(undefined, { mcp: false, cli: false })).toEqual({
            browser: true,
            mcp: false,
            cli: false,
        })
    })

    test('explicit flags win over computed defaults', () => {
        expect(resolveClientFlags({ mcp: true }, { mcp: false, cli: false })).toEqual({
            browser: true,
            mcp: true,
            cli: false,
        })
        expect(resolveClientFlags({ browser: false }, { mcp: true, cli: true })).toEqual({
            browser: false,
            mcp: true,
            cli: true,
        })
    })
})
