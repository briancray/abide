import { describe, expect, test } from 'bun:test'
import { matchRoute } from '../src/lib/ui/matchRoute.ts'

describe('matchRoute', () => {
    const routes = ['/users', '/users/[id]', '/files/[...rest]']

    test('matches a literal route', () => {
        expect(matchRoute(routes, '/users')).toEqual({ route: '/users', params: {} })
    })

    test('captures a [name] param', () => {
        expect(matchRoute(routes, '/users/5')).toEqual({
            route: '/users/[id]',
            params: { id: '5' },
        })
    })

    test('a trailing slash matches the slash-free route (not a 404, no empty param)', () => {
        // `/users/` must resolve to `/users`, not 404 and not `/users/[id]` with id=''
        expect(matchRoute(routes, '/users/')).toEqual({ route: '/users', params: {} })
    })

    test('a [name] param never captures an empty segment', () => {
        expect(matchRoute(['/users/[id]'], '/users//')).toBeUndefined()
    })

    test('the most specific (most literal) route wins', () => {
        expect(matchRoute(routes, '/users/9')).toEqual({
            route: '/users/[id]',
            params: { id: '9' },
        })
    })

    test('a catch-all captures the remaining segments with slashes intact', () => {
        expect(matchRoute(routes, '/files/a/b/c')).toEqual({
            route: '/files/[...rest]',
            params: { rest: 'a/b/c' },
        })
    })

    test('a [name] param is percent-decoded to match Bun-decoded server params', () => {
        // `The Daily Show` arrives as `The%20Daily%20Show`; the page must see spaces.
        expect(matchRoute(routes, `/users/${encodeURIComponent('The Daily Show')}`)).toEqual({
            route: '/users/[id]',
            params: { id: 'The Daily Show' },
        })
    })

    test('a malformed percent sequence falls back to the raw value (no crash)', () => {
        // `decodeURIComponent` throws on `%E0%A4%A`; Bun keeps it, so we must not crash.
        expect(matchRoute(routes, '/users/%E0%A4%A')).toEqual({
            route: '/users/[id]',
            params: { id: '%E0%A4%A' },
        })
    })

    test('a catch-all stays raw (server reconstructs it from the raw pathname)', () => {
        expect(matchRoute(routes, `/files/a/${encodeURIComponent('b c')}`)).toEqual({
            route: '/files/[...rest]',
            params: { rest: 'a/b%20c' },
        })
    })
})
