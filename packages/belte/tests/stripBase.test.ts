import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { baseSlot } from '../src/lib/shared/baseSlot.ts'
import { stripBase } from '../src/lib/shared/stripBase.ts'

describe('stripBase', () => {
    beforeEach(() => {
        baseSlot.fallback = undefined
        baseSlot.resolver = undefined
    })
    afterEach(() => {
        baseSlot.fallback = undefined
        baseSlot.resolver = undefined
    })

    test('returns the pathname untouched at root mount', () => {
        expect(stripBase('/people')).toBe('/people')
    })

    test('strips the base from a mounted pathname', () => {
        baseSlot.fallback = '/v2'
        expect(stripBase('/v2/people')).toBe('/people')
    })

    test('the bare base resolves to /', () => {
        baseSlot.fallback = '/v2'
        expect(stripBase('/v2')).toBe('/')
    })

    test('a false prefix like /v2x is not stripped', () => {
        baseSlot.fallback = '/v2'
        expect(stripBase('/v2x/people')).toBe('/v2x/people')
    })

    test('a pathname outside the base is returned untouched', () => {
        baseSlot.fallback = '/v2'
        expect(stripBase('/people')).toBe('/people')
    })
})
