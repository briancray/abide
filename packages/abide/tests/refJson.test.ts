import { describe, expect, test } from 'bun:test'
import { decodeRefJson } from '../src/lib/shared/decodeRefJson.ts'
import { encodeRefJson } from '../src/lib/shared/encodeRefJson.ts'

// Encode then decode; the codec's whole job is that this is identity-preserving.
function roundTrip(value: unknown): unknown {
    return decodeRefJson(encodeRefJson(value))
}

describe('encodeRefJson / decodeRefJson', () => {
    test('round-trips plain JSON values', () => {
        const value = { a: 1, b: 'two', c: true, d: null, e: [1, 2, [3]] }
        expect(roundTrip(value)).toEqual(value)
    })

    test('survives a direct cycle', () => {
        const node: Record<string, unknown> = { name: 'root' }
        node.self = node
        const decoded = roundTrip(node) as Record<string, unknown>
        expect(decoded.name).toBe('root')
        // The cycle must reconnect to the same object, not a copy.
        expect(decoded.self).toBe(decoded)
    })

    test('survives a mutual cycle', () => {
        const a: Record<string, unknown> = { tag: 'a' }
        const b: Record<string, unknown> = { tag: 'b' }
        a.peer = b
        b.peer = a
        const decoded = roundTrip(a) as Record<string, unknown>
        expect((decoded.peer as Record<string, unknown>).peer).toBe(decoded)
    })

    test('preserves shared references as the same object', () => {
        const shared = { id: 7 }
        const decoded = roundTrip([shared, shared, { nested: shared }]) as [
            object,
            object,
            { nested: object },
        ]
        expect(decoded[0]).toBe(decoded[1])
        expect(decoded[2].nested).toBe(decoded[0])
    })

    test('round-trips the types JSON drops or coerces', () => {
        const value = {
            undef: undefined,
            big: 9007199254740993n,
            nan: Number.NaN,
            inf: Number.POSITIVE_INFINITY,
            negInf: Number.NEGATIVE_INFINITY,
            negZero: -0,
            date: new Date('2026-06-22T00:00:00.000Z'),
            regexp: /ab+c/gi,
        }
        const decoded = roundTrip(value) as typeof value
        expect('undef' in decoded).toBe(true)
        expect(decoded.undef).toBeUndefined()
        expect(decoded.big).toBe(9007199254740993n)
        expect(decoded.nan).toBeNaN()
        expect(decoded.inf).toBe(Number.POSITIVE_INFINITY)
        expect(decoded.negInf).toBe(Number.NEGATIVE_INFINITY)
        expect(Object.is(decoded.negZero, -0)).toBe(true)
        expect(decoded.date).toBeInstanceOf(Date)
        expect(decoded.date.getTime()).toBe(value.date.getTime())
        expect(decoded.regexp.source).toBe('ab+c')
        expect(decoded.regexp.flags).toBe('gi')
    })

    test('round-trips Map and Set, including object keys/members', () => {
        const key = { k: 1 }
        const map = new Map<unknown, unknown>([
            ['a', 1],
            [key, 'byObject'],
        ])
        const set = new Set([1, key, 'x'])
        const decoded = roundTrip({ map, set }) as { map: Map<unknown, unknown>; set: Set<unknown> }
        expect(decoded.map).toBeInstanceOf(Map)
        expect(decoded.map.get('a')).toBe(1)
        // The object key must be the decoded object, not a copy.
        const decodedKey = [...decoded.set].find(
            (member) => typeof member === 'object' && member !== null,
        )
        expect(decoded.map.get(decodedKey)).toBe('byObject')
        expect(decoded.set.has(1)).toBe(true)
    })

    test('a Map that contains itself reconnects', () => {
        const map = new Map<string, unknown>()
        map.set('self', map)
        const decoded = roundTrip(map) as Map<string, unknown>
        expect(decoded.get('self')).toBe(decoded)
    })

    test('folds functions and symbols to undefined like JSON', () => {
        const decoded = roundTrip({ fn: () => 1, sym: Symbol('s'), keep: 2 }) as Record<
            string,
            unknown
        >
        expect(decoded.fn).toBeUndefined()
        expect(decoded.sym).toBeUndefined()
        expect(decoded.keep).toBe(2)
    })

    test('handles primitive and undefined roots', () => {
        expect(roundTrip(42)).toBe(42)
        expect(roundTrip('hi')).toBe('hi')
        expect(roundTrip(undefined)).toBeUndefined()
        expect(roundTrip(null)).toBeNull()
    })

    test('rejects payloads that are not ref-json', () => {
        expect(() => decodeRefJson('null')).toThrow()
        expect(() => decodeRefJson('[]')).toThrow()
    })

    test('an own __proto__ key round-trips as a plain key without touching the prototype', () => {
        const source = JSON.parse('{"__proto__": {"polluted": true}, "keep": 1}') as Record<
            string,
            unknown
        >
        const decoded = roundTrip(source) as Record<string, unknown>
        expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
        expect(Object.getOwnPropertyDescriptor(decoded, '__proto__')?.value).toEqual({
            polluted: true,
        })
        expect(decoded.keep).toBe(1)
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })

    test('a crafted wire __proto__ reference cannot hijack the decoded prototype', () => {
        const wire = '[["~r",0],[{"__proto__":["~r",1]},{"~a":1,"polluted":true}]]'
        const decoded = decodeRefJson(wire) as Record<string, unknown>
        expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
        expect(decoded.polluted).toBeUndefined()
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })
})
