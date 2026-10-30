import { expect, test } from 'bun:test'

import { clientTags } from '#server/answerRequest.ts'
import { type HasParams, type HasSegments, url } from '#shared'
import { GET } from '#shared/rpc.ts'

// 30.1, 30.3 — A REQUIRED SEGMENT IS FILLED, and encoded as a segment: a slash in a value is data,
// not another directory.
test('url fills a required segment, encoded — 30.1, 30.3', () => {
    expect(url('/invoices/[id]', { id: 4310 })).toBe('/invoices/4310')
    expect(url('/files/[name]', { name: 'a/b c' })).toBe('/files/a%2Fb%20c')
})

// 30.4 — LEAVING AN OPTIONAL OUT OMITS ITS SEGMENT rather than writing an empty one. THE REVERT:
// write `/${value}` for a missing optional; the address reads `/reports/` with a hole in it.
test('an optional left out omits its segment — 30.4', () => {
    expect(url('/reports/[[year]]')).toBe('/reports')
    expect(url('/reports/[[year]]', { year: 2026 })).toBe('/reports/2026')
})

// 30.5 — a rest takes an array as well as a scalar, and nothing at all.
test('a rest takes an array, a scalar, or nothing — 30.5', () => {
    expect(url('/docs/[...path]', { path: ['guide', 'start'] })).toBe(
        '/docs/guide/start',
    )
    expect(url('/docs/[...path]', { path: 'intro' })).toBe('/docs/intro')
    expect(url('/docs/[...path]')).toBe('/docs')
})

// 30.6 — the query half is last, a list its member repeated.
test('the query argument is last — 30.6', () => {
    expect(
        url('/search', {}, { q: 'ink', tag: ['a', 'b'], skip: undefined }),
    ).toBe('/search?q=ink&tag=a&tag=b')
    expect(url('/', undefined, new URLSearchParams({ page: '2' }))).toBe(
        '/?page=2',
    )
    // `null` is text here as it is in an rpc's args, where 19.7 reads it back.
    expect(url('/search', {}, { q: null })).toBe('/search?q=null')
    expect(url()).toBe('/')
})

// 30.28 — `url`'S QUERY IS SPELLED AS AN `Rpc`'S ARGS ARE: an empty list its bare name, after the
// rest, which 19.7 reads back as `[]` — and `['']` the one-member list. Asked of both, since the two
// once kept the rule apart. THE REVERT: drop the empty-list arm from `queryText` (as `url`'s spelling
// was); `url` writes no `tags` at all, and `rpc.url` neither.
test("url's query spells an empty list as an rpc's args do — 30.28", () => {
    expect(url('/search', {}, { tags: [], q: 'ink' })).toBe(
        '/search?q=ink&tags',
    )
    expect(url('/search', {}, { tags: [''] })).toBe('/search?tags=')
    const search = GET(({ tags }: { tags: string[]; q?: string }) => tags)
    ;(search as { address?: string }).address = '/search'
    expect(search.url({ tags: [], q: 'ink' })).toBe('/search?q=ink&tags')
})

// 30.2 — THE LITERAL DECIDES THE ARITY, at compile time. The `@ts-expect-error` lines are the gate:
// `bun run typecheck` fails where one of them stops being an error.
test('a required segment makes the params argument required — 30.2', () => {
    // @ts-expect-error — the literal carries a required segment, so params are required.
    expect(() => url('/invoices/[id]')).toThrow('30.3')
    // @ts-expect-error — and the key is the segment's name.
    expect(() => url('/invoices/[id]', { number: 1 })).toThrow('30.3')
    url('/invoices')
    url('/reports/[[year]]')
    const required: HasParams<'/a/[id]'> = true
    const optionalOnly: HasParams<'/a/[[id]]'> = false
    const segmented: HasSegments<'/a/[...rest]'> = true
    const plain: HasSegments<'/a/b'> = false
    // A value that may be any of several literals takes its params optionally: one with a required
    // segment among them does not make every call demand that member's params.
    const anyOf = '/invoices' as '/invoices' | '/invoices/[id]'
    url(anyOf)
    const mixed: HasParams<'/invoices' | '/invoices/[id]'> = false
    expect([required, optionalOnly, segmented, plain, mixed]).toEqual([
        true,
        false,
        true,
        false,
        false,
    ])
})

// 16.10 — THE MOUNT IS READ ONCE, not per address. A document abide did not render names no mount,
// and a lookup that misses walks the whole document, so `url()` per `{#for}` row was quadratic in
// the page. THE REVERT: drop the memo in `documentMount`; the selector runs 100 times rather than
// at most 1.
test('url reads the document mount at most once — 16.10', () => {
    const querySelector = document.querySelector.bind(document)
    let lookups = 0
    document.querySelector = ((selector: string) => {
        if (selector.includes('abide-mount')) lookups += 1
        return querySelector(selector)
    }) as typeof document.querySelector
    try {
        for (let at = 0; at < 100; at += 1) url('/cards/[id]', { id: at })
    } finally {
        document.querySelector = querySelector
    }
    expect(lookups).toBeLessThanOrEqual(1)
})

// 16.10 — THE DOCUMENT NAMES THE MOUNT AT THE ROOT TOO, so the browser's one lookup is a hit rather
// than a walk of the whole page. THE REVERT: write the tag only where the mount is not `''`.
test('the document names the root mount — 16.10', () => {
    const tags = clientTags(
        { entry: 'entry.js', stylesheet: undefined, chunks: {} } as never,
        [],
    )
    expect(tags).toContain('<meta name="abide-mount" content="">')
})

// 30.1 — A `.` OR `..` VALUE IS REFUSED, not written: the URL parser collapses it as a dot-segment,
// and `%2E%2E` with it, so `/users/../edit` lands on `/edit` — another route than the one filled.
// THE REVERT: encode the value with `encodeURIComponent` alone in `url`; the call returns
// `/users/../edit` rather than throwing.
test('a value carrying a period is refused rather than written — 30.19, 30.34', () => {
    expect(new URL('/users/%2E%2E/edit', 'http://x').pathname).toBe('/edit')
    expect(() => url('/users/[id]/edit', { id: '..' })).toThrow('30.19')
    expect(() => url('/users/[id]/edit', { id: '.' })).toThrow('30.19')
    expect(() => url('/docs/[...path]', { path: ['a', '..', 'b'] })).toThrow(
        '30.1',
    )
    // 30.34 — NOR ONE CARRYING A PERIOD ANYWHERE: no param matches it, so the address would reach
    // another route or none. THE REVERT: refuse only `.` and `..` in `encodedSegment`.
    expect(() => url('/files/[name]', { name: '..rc' })).toThrow('30.19')
    expect(() => url('/[home]', { home: 'favicon.ico' })).toThrow('30.19')
})
