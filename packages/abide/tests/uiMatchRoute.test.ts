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
})
