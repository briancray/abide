import { describe, expect, test } from 'bun:test'
import { basePathFromAppUrl } from '../src/lib/shared/basePathFromAppUrl.ts'

describe('basePathFromAppUrl', () => {
    test('takes the pathname from a full APP_URL', () => {
        expect(basePathFromAppUrl('https://foo.com/v2')).toBe('/v2')
        expect(basePathFromAppUrl('https://foo.com/team/app')).toBe('/team/app')
    })

    test('strips a trailing slash and collapses root to empty', () => {
        expect(basePathFromAppUrl('https://foo.com/v2/')).toBe('/v2')
        expect(basePathFromAppUrl('https://foo.com/')).toBe('')
        expect(basePathFromAppUrl('https://foo.com')).toBe('')
    })

    test('defaults to root mount when unset', () => {
        expect(basePathFromAppUrl(undefined)).toBe('')
        expect(basePathFromAppUrl('')).toBe('')
    })

    test('tolerates a bare path value with no origin', () => {
        expect(basePathFromAppUrl('/v2')).toBe('/v2')
        expect(basePathFromAppUrl('/v2/')).toBe('/v2')
    })
})
