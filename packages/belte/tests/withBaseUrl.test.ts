import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { baseSlot } from '../src/lib/shared/baseSlot.ts'
import { withBaseUrl } from '../src/lib/shared/withBaseUrl.ts'

describe('withBaseUrl', () => {
    beforeEach(() => {
        baseSlot.fallback = undefined
        baseSlot.resolver = undefined
    })
    afterEach(() => {
        baseSlot.fallback = undefined
        baseSlot.resolver = undefined
    })

    test('returns the same URL untouched at root mount', () => {
        const url = new URL('http://localhost:3000/people?tab=active')
        expect(withBaseUrl(url)).toBe(url)
    })

    test('prefixes the pathname with the base, preserving search and hash', () => {
        baseSlot.fallback = '/v2'
        const prefixed = withBaseUrl(new URL('http://localhost:3000/people?tab=active#row-3'))
        expect(prefixed.pathname).toBe('/v2/people')
        expect(prefixed.search).toBe('?tab=active')
        expect(prefixed.hash).toBe('#row-3')
    })

    test('does not mutate the input URL', () => {
        baseSlot.fallback = '/v2'
        const original = new URL('http://localhost:3000/people')
        withBaseUrl(original)
        expect(original.pathname).toBe('/people')
    })
})
