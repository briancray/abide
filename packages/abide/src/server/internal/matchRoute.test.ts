// Route matching: literal, `[name]` required, `[[name]]` optional, and `[...name]` rest segments,
// plus the specificity precedence between them.

import { expect, test } from 'bun:test'
import { matchRoute } from './matchRoute.ts'

test('literal and required [name] segments', () => {
    const patterns = ['/users/[id]', '/users/new']
    expect(matchRoute(patterns, '/users/42')).toEqual({
        pattern: '/users/[id]',
        params: { id: '42' },
    })
    // An exact literal beats the param route regardless of order.
    expect(matchRoute(patterns, '/users/new')).toEqual({ pattern: '/users/new', params: {} })
    expect(matchRoute(patterns, '/users/1/2')).toBeNull()
})

test('a required segment decodes its value', () => {
    expect(matchRoute(['/tag/[name]'], '/tag/a%2Fb')).toEqual({
        pattern: '/tag/[name]',
        params: { name: 'a/b' },
    })
})

test('optional [[name]] matches with and without the segment', () => {
    const patterns = ['/blog/[[page]]']
    expect(matchRoute(patterns, '/blog')).toEqual({ pattern: '/blog/[[page]]', params: {} })
    expect(matchRoute(patterns, '/blog/2')).toEqual({
        pattern: '/blog/[[page]]',
        params: { page: '2' },
    })
    // The optional consumes at most one segment.
    expect(matchRoute(patterns, '/blog/2/3')).toBeNull()
})

test('optional segment in the middle of a pattern', () => {
    const patterns = ['/[[lang]]/about']
    expect(matchRoute(patterns, '/about')).toEqual({ pattern: '/[[lang]]/about', params: {} })
    expect(matchRoute(patterns, '/fr/about')).toEqual({
        pattern: '/[[lang]]/about',
        params: { lang: 'fr' },
    })
})

test('rest [...name] captures the remaining segments as a joined string', () => {
    const patterns = ['/docs/[...path]']
    expect(matchRoute(patterns, '/docs/a/b/c')).toEqual({
        pattern: '/docs/[...path]',
        params: { path: 'a/b/c' },
    })
    // Rest matches a single trailing segment too.
    expect(matchRoute(patterns, '/docs/intro')).toEqual({
        pattern: '/docs/[...path]',
        params: { path: 'intro' },
    })
    // Rest matches zero trailing segments (empty string).
    expect(matchRoute(patterns, '/docs')).toEqual({
        pattern: '/docs/[...path]',
        params: { path: '' },
    })
})

test('rest decodes each captured segment', () => {
    expect(matchRoute(['/f/[...rest]'], '/f/a%20b/c')).toEqual({
        pattern: '/f/[...rest]',
        params: { rest: 'a b/c' },
    })
})

test('specificity: literal beats required beats optional beats rest', () => {
    const patterns = ['/docs/[...path]', '/docs/[section]', '/docs/[[page]]', '/docs/api']
    // Exact literal wins.
    expect(matchRoute(patterns, '/docs/api')?.pattern).toBe('/docs/api')
    // Required beats optional and rest for a single segment.
    expect(matchRoute(patterns, '/docs/guide')?.pattern).toBe('/docs/[section]')
    // Only rest matches a multi-segment tail.
    expect(matchRoute(patterns, '/docs/a/b')?.pattern).toBe('/docs/[...path]')
})

test('a more specific dynamic pattern wins over a broader catch-all', () => {
    const patterns = ['/[...all]', '/users/[id]']
    expect(matchRoute(patterns, '/users/7')?.pattern).toBe('/users/[id]')
    expect(matchRoute(patterns, '/x/y/z')?.pattern).toBe('/[...all]')
})

test('root path and no-match', () => {
    expect(matchRoute(['/'], '/')).toEqual({ pattern: '/', params: {} })
    expect(matchRoute(['/about'], '/contact')).toBeNull()
})
