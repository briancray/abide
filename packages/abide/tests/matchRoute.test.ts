import { describe, expect, test } from 'bun:test'
import { matchRoute } from '../src/lib/shared/matchRoute.ts'

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

    test('a catch-all decodes each sub-segment, keeping / separators', () => {
        // Matches the server's reconstruction: split raw, decode per segment, rejoin —
        // so an encoded `/` (%2F) stays inside one sub-segment instead of splitting it.
        expect(matchRoute(routes, `/files/a/${encodeURIComponent('b c')}`)).toEqual({
            route: '/files/[...rest]',
            params: { rest: 'a/b c' },
        })
    })

    test('a catch-all matches zero remaining segments as an empty value', () => {
        expect(matchRoute(['/files/[...rest]'], '/files')).toEqual({
            route: '/files/[...rest]',
            params: { rest: '' },
        })
    })
})

describe('matchRoute [[optional]]', () => {
    test('an absent optional matches with the param omitted', () => {
        expect(matchRoute(['/[[lang]]/about'], '/about')).toEqual({
            route: '/[[lang]]/about',
            params: {},
        })
    })

    test('a present optional captures like [name]', () => {
        expect(matchRoute(['/[[lang]]/about'], '/en/about')).toEqual({
            route: '/[[lang]]/about',
            params: { lang: 'en' },
        })
    })

    test('a trailing optional matches with and without the segment', () => {
        expect(matchRoute(['/docs/[[page]]'], '/docs')).toEqual({
            route: '/docs/[[page]]',
            params: {},
        })
        expect(matchRoute(['/docs/[[page]]'], '/docs/intro')).toEqual({
            route: '/docs/[[page]]',
            params: { page: 'intro' },
        })
    })

    test('an optional never captures an empty segment (trailing slash falls back to absent)', () => {
        expect(matchRoute(['/docs/[[page]]'], '/docs/')).toEqual({
            route: '/docs/[[page]]',
            params: {},
        })
    })

    test('an optional value percent-decodes like [name]', () => {
        expect(matchRoute(['/docs/[[page]]'], '/docs/a%20b')).toEqual({
            route: '/docs/[[page]]',
            params: { page: 'a b' },
        })
    })

    test('extra segments beyond a trailing optional do not match', () => {
        expect(matchRoute(['/docs/[[page]]'], '/docs/a/b')).toBeUndefined()
    })

    test('adjacent optionals consume greedily left to right', () => {
        expect(matchRoute(['/[[a]]/[[b]]'], '/x')).toEqual({
            route: '/[[a]]/[[b]]',
            params: { a: 'x' },
        })
        expect(matchRoute(['/[[a]]/[[b]]'], '/x/y')).toEqual({
            route: '/[[a]]/[[b]]',
            params: { a: 'x', b: 'y' },
        })
    })

    test('an optional composes with a later catch-all', () => {
        const routes = ['/[[lang]]/docs/[...rest]']
        expect(matchRoute(routes, '/docs/a/b')).toEqual({
            route: '/[[lang]]/docs/[...rest]',
            params: { rest: 'a/b' },
        })
        expect(matchRoute(routes, '/en/docs/a/b')).toEqual({
            route: '/[[lang]]/docs/[...rest]',
            params: { lang: 'en', rest: 'a/b' },
        })
    })

    test('a greedy consume backtracks when a later literal needs the segment', () => {
        expect(matchRoute(['/[[lang]]/about'], '/about/about')).toEqual({
            route: '/[[lang]]/about',
            params: { lang: 'about' },
        })
    })
})

describe('matchRoute normalization and backtracking', () => {
    test('a root-level optional matches the bare root', () => {
        expect(matchRoute(['/[[lang]]'], '/')).toEqual({ route: '/[[lang]]', params: {} })
        expect(matchRoute(['/[[a]]/[[b]]'], '/')).toEqual({ route: '/[[a]]/[[b]]', params: {} })
    })

    test('duplicate slashes collapse before matching', () => {
        expect(matchRoute(['/users'], '//users')).toEqual({ route: '/users', params: {} })
        expect(matchRoute(['/users/[id]'], '/users//5')).toEqual({
            route: '/users/[id]',
            params: { id: '5' },
        })
    })

    test('a failed optional consume restores a same-named earlier capture', () => {
        expect(matchRoute(['/[x]/[[x]]/y'], '/1/y')).toEqual({
            route: '/[x]/[[x]]/y',
            params: { x: '1' },
        })
    })
})

describe('matchRoute specificity', () => {
    test('a literal at an earlier position wins over a param there, regardless of order', () => {
        for (const routes of [
            ['/a/[b]', '/[a]/b'],
            ['/[a]/b', '/a/[b]'],
        ]) {
            expect(matchRoute(routes, '/a/b')).toEqual({ route: '/a/[b]', params: { b: 'b' } })
        }
    })

    test('positional compare: a literal head beats a param head even against a catch-all tail', () => {
        for (const routes of [
            ['/y/[...rest]', '/[a]/x'],
            ['/[a]/x', '/y/[...rest]'],
        ]) {
            expect(matchRoute(routes, '/y/x')).toEqual({
                route: '/y/[...rest]',
                params: { rest: 'x' },
            })
        }
    })

    test('a route without the optional beats the optional route, regardless of order', () => {
        for (const routes of [
            ['/about', '/[[lang]]/about'],
            ['/[[lang]]/about', '/about'],
        ]) {
            expect(matchRoute(routes, '/about')).toEqual({ route: '/about', params: {} })
        }
    })

    test('an optional route beats a catch-all route, regardless of order', () => {
        for (const routes of [
            ['/x/[[opt]]', '/x/[...rest]'],
            ['/x/[...rest]', '/x/[[opt]]'],
        ]) {
            expect(matchRoute(routes, '/x/y')).toEqual({
                route: '/x/[[opt]]',
                params: { opt: 'y' },
            })
        }
    })

    test('a required param beats an optional at the same position, regardless of order', () => {
        for (const routes of [
            ['/x/[id]', '/x/[[opt]]'],
            ['/x/[[opt]]', '/x/[id]'],
        ]) {
            expect(matchRoute(routes, '/x/y')).toEqual({
                route: '/x/[id]',
                params: { id: 'y' },
            })
        }
    })
})
