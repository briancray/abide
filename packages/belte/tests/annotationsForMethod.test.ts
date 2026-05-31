import { describe, expect, test } from 'bun:test'
import { annotationsForMethod } from '../src/lib/mcp/annotationsForMethod.ts'

describe('annotationsForMethod', () => {
    test('reads are read-only and non-destructive', () => {
        expect(annotationsForMethod('GET')).toEqual({ readOnlyHint: true, destructiveHint: false })
        expect(annotationsForMethod('HEAD')).toEqual({ readOnlyHint: true, destructiveHint: false })
    })

    test('PUT and DELETE are destructive + idempotent', () => {
        expect(annotationsForMethod('PUT')).toEqual({
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
        })
        expect(annotationsForMethod('DELETE')).toEqual({
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
        })
    })

    test('PATCH is destructive but not idempotent', () => {
        expect(annotationsForMethod('PATCH')).toEqual({
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
        })
    })

    test('POST is a non-idempotent, non-destructive write', () => {
        expect(annotationsForMethod('POST')).toEqual({
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
        })
    })
})
