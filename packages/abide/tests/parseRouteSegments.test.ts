import { describe, expect, test } from 'bun:test'
import { parseRouteSegments } from '../src/lib/shared/parseRouteSegments.ts'

describe('parseRouteSegments', () => {
    test('splits literals, params, and catch-alls', () => {
        expect(parseRouteSegments('/media/[id]/[...rest]')).toEqual([
            { kind: 'literal', value: '' },
            { kind: 'literal', value: 'media' },
            { kind: 'param', name: 'id', catchAll: false, optional: false },
            { kind: 'param', name: 'rest', catchAll: true, optional: false },
        ])
    })

    test('[[name]] parses as an optional param', () => {
        expect(parseRouteSegments('/[[lang]]/about')).toEqual([
            { kind: 'literal', value: '' },
            { kind: 'param', name: 'lang', catchAll: false, optional: true },
            { kind: 'literal', value: 'about' },
        ])
    })

    test('[[...rest]] normalizes to a plain catch-all (already matches zero segments)', () => {
        expect(parseRouteSegments('/files/[[...rest]]')).toEqual(
            parseRouteSegments('/files/[...rest]'),
        )
    })
})
