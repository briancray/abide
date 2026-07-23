// url() — filling `[name]`, `[[name]]` (optional) and `[...name]` (rest) segments, plus query append.

import { expect, test } from 'bun:test'
import { url } from './url.ts'

test('fills required [name] segments', () => {
    expect(url('/users/[id]', { id: 7 })).toBe('/users/7')
    expect(url('/users/[id]/posts/[postId]', { id: 3, postId: 9 })).toBe('/users/3/posts/9')
    expect(() => url('/users/[id]', {} as unknown as { id: string })).toThrow()
})

test('optional [[name]] fills when present, drops when absent', () => {
    expect(url('/blog/[[page]]', { page: 2 })).toBe('/blog/2')
    expect(url('/blog/[[page]]')).toBe('/blog')
    expect(url('/blog/[[page]]', {})).toBe('/blog')
    // A middle optional collapses cleanly (no double slash).
    expect(url('/[[lang]]/about', {})).toBe('/about')
    expect(url('/[[lang]]/about', { lang: 'fr' })).toBe('/fr/about')
})

test('rest [...name] fills from a joined string', () => {
    expect(url('/docs/[...path]', { path: 'a/b/c' })).toBe('/docs/a/b/c')
    expect(url('/docs/[...path]', { path: '' })).toBe('/docs')
    expect(() => url('/docs/[...path]', {} as unknown as { path: string })).toThrow()
})

test('encodes filled segments', () => {
    expect(url('/tag/[name]', { name: 'a/b' })).toBe('/tag/a%2Fb')
    expect(url('/docs/[...path]', { path: 'a b/c' })).toBe('/docs/a%20b/c')
})

test('appends query alongside dynamic segments', () => {
    expect(url('/users/[id]', { id: 7 }, { tab: 'posts', page: 2 })).toBe(
        '/users/7?tab=posts&page=2',
    )
    expect(url('/blog/[[page]]', {}, { sort: 'new' })).toBe('/blog?sort=new')
})

test('static paths keep the (path, query) shape', () => {
    expect(url('/search', { q: 'abide framework' })).toBe('/search?q=abide+framework')
    expect(url('/plain')).toBe('/plain')
})
