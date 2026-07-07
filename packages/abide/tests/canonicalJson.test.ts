import { describe, expect, test } from 'bun:test'
import { canonicalJson } from '../src/lib/shared/canonicalJson.ts'

describe('canonicalJson', () => {
    test('object key order does not change the key', () => {
        expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }))
    })

    test('distinct types never collide', () => {
        expect(canonicalJson(new Map([['a', 1]]))).not.toBe(canonicalJson({ a: 1 }))
        expect(canonicalJson(new Date(0))).not.toBe(canonicalJson('1970-01-01T00:00:00.000Z'))
    })

    test('FormData with different fields produces different keys (the coalescing bug)', () => {
        const a = new FormData()
        a.append('name', 'alice')
        const b = new FormData()
        b.append('name', 'bob')
        // The bug: both collapsed to "{}" via the generic object branch → same cache key.
        expect(canonicalJson(a)).not.toBe(canonicalJson(b))
        expect(canonicalJson(a)).not.toBe('{}')
    })

    test('FormData field order does not change the key', () => {
        const a = new FormData()
        a.append('x', '1')
        a.append('y', '2')
        const b = new FormData()
        b.append('y', '2')
        b.append('x', '1')
        expect(canonicalJson(a)).toBe(canonicalJson(b))
    })

    test('distinct files (name/size/type) get distinct keys', () => {
        const fileA = new File(['hello'], 'a.txt', { type: 'text/plain' })
        const fileB = new File(['world!'], 'b.txt', { type: 'text/plain' })
        const a = new FormData()
        a.append('upload', fileA)
        const b = new FormData()
        b.append('upload', fileB)
        expect(canonicalJson(a)).not.toBe(canonicalJson(b))
    })
})
