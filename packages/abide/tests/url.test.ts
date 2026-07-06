import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { baseSlot } from '../src/lib/shared/baseSlot.ts'
import { url } from '../src/lib/shared/url.ts'

/* A booted server elsewhere may have left a resolver in the slot; clear both so
   these tests drive the base purely through `fallback`. */
beforeEach(() => {
    baseSlot.fallback = undefined
    baseSlot.resolver = undefined
})
afterEach(() => {
    baseSlot.fallback = undefined
    baseSlot.resolver = undefined
})

describe('url at root mount', () => {
    test('returns a rooted path unchanged', () => {
        expect(url('/about')).toBe('/about')
    })

    test('interpolates [name] params', () => {
        expect(url('/product/[id]', { id: 5 })).toBe('/product/5')
    })

    test('interpolates [...rest] catch-all params, slashes intact', () => {
        expect(url('/files/[...path]', { path: 'a/b/c' })).toBe('/files/a/b/c')
    })

    test('interpolates [name] params before a [...rest] catch-all', () => {
        // also a type-level check: PathParams must keep `id` alongside `rest`
        expect(url('/media/[id]/[...rest]', { id: 5, rest: 'play' })).toBe('/media/5/play')
    })

    test('URL-encodes [name] param values so they cannot alter the path', () => {
        expect(url('/product/[id]', { id: 'a/b' })).toBe('/product/a%2Fb')
        expect(url('/user/[name]', { name: 'José Q' })).toBe('/user/Jos%C3%A9%20Q')
        expect(url('/p/[q]', { q: 'a?b#c' })).toBe('/p/a%3Fb%23c')
    })

    test('[...rest] encodes each sub-segment but keeps the slashes', () => {
        expect(url('/files/[...path]', { path: 'a b/c?d' })).toBe('/files/a%20b/c%3Fd')
    })

    test('appends query after path params', () => {
        expect(url('/product/[id]', { id: 5 }, { sort: 'asc' })).toBe('/product/5?sort=asc')
    })

    test('interpolates a provided [[optional]] param like [name]', () => {
        expect(url('/docs/[[page]]', { page: 'intro' })).toBe('/docs/intro')
        expect(url('/[[lang]]/about', { lang: 'en' })).toBe('/en/about')
    })

    test('drops an absent [[optional]] segment and its slash', () => {
        expect(url('/docs/[[page]]', {})).toBe('/docs')
        expect(url('/docs/[[page]]', { page: undefined })).toBe('/docs')
        expect(url('/[[lang]]/about', {})).toBe('/about')
    })

    test('a root-level absent [[optional]] resolves to /', () => {
        expect(url('/[[lang]]', {})).toBe('/')
    })

    test('appends query after [[optional]] params, absent or present', () => {
        expect(url('/docs/[[page]]', {}, { q: 'x' })).toBe('/docs?q=x')
        expect(url('/docs/[[page]]', { page: 'intro' }, { q: 'x' })).toBe('/docs/intro?q=x')
    })

    test('treats the second arg as query when the path has no params', () => {
        expect(url('/search', { q: 'hi', page: 2 })).toBe('/search?q=hi&page=2')
    })

    test('leaves an asset path as a bare prefix', () => {
        expect(url('/logo.png')).toBe('/logo.png')
    })
})

describe('url under a /v2 mount', () => {
    test('prepends the base to rooted internal paths', () => {
        baseSlot.fallback = '/v2'
        expect(url('/about')).toBe('/v2/about')
        expect(url('/product/[id]', { id: 5 }, { sort: 'asc' })).toBe('/v2/product/5?sort=asc')
        expect(url('/logo.png')).toBe('/v2/logo.png')
    })

    test('never prefixes or rewrites external URLs', () => {
        baseSlot.fallback = '/v2'
        expect(url('https://other.com/x')).toBe('https://other.com/x')
        expect(url('//cdn.com/a.js')).toBe('//cdn.com/a.js')
        expect(url('mailto:a@b.com')).toBe('mailto:a@b.com')
    })
})
