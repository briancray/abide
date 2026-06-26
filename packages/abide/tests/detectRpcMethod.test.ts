import { describe, expect, test } from 'bun:test'
import { detectRpcMethod } from '../src/lib/shared/detectRpcMethod.ts'

describe('detectRpcMethod', () => {
    test('reads the rpc from the export convention', () => {
        expect(detectRpcMethod('export const getHello = GET(() => json({}))')).toBe('GET')
        expect(detectRpcMethod('export const make = POST(handler)')).toBe('POST')
        expect(detectRpcMethod('export const drop = DELETE(handler)')).toBe('DELETE')
    })

    test('reads through an explicit args generic', () => {
        expect(detectRpcMethod('export const find = GET<{ id: string }>(handler)')).toBe('GET')
    })

    test('ignores incidental rpc mentions outside the export', () => {
        // A handler that calls fetch or names a rpc in a comment must not be read as the method.
        const source = `// uses GET semantics\nexport const make = POST(() => fetch('/x'))`
        expect(detectRpcMethod(source)).toBe('POST')
    })

    test('returns undefined when no rpc export matches', () => {
        expect(detectRpcMethod('export const helper = () => 1')).toBeUndefined()
        expect(detectRpcMethod('')).toBeUndefined()
    })
})
