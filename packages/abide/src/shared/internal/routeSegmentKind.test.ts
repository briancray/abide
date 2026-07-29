// The bracket grammar, and the property that matters about it: `matchRoute` and `resolveUrl` are
// INVERSES. One decides whether a pathname matches a pattern; the other fills that pattern back into an
// href. While each carried a private copy of the classification they could disagree — and did, once,
// producing a link no route could match.
//
// So this asserts the classifier directly AND round-trips through both modules, because the classifier
// agreeing with itself is not the contract.

import { describe, expect, test } from 'bun:test'
import { url } from '../url.ts'
import { matchRoute } from './matchRoute.ts'
import {
    classifyRouteSegment,
    LITERAL,
    OPTIONAL,
    REQUIRED,
    REST,
    type RouteSegmentKind,
} from './routeSegmentKind.ts'

describe('classifyRouteSegment', () => {
    // Typed explicitly: an untyped heterogeneous `test.each` table widens the kind column to
    // `string | number`, which no longer matches `ClassifiedSegment`.
    const CASES: [segment: string, kind: RouteSegmentKind, name: string][] = [
        ['users', LITERAL, ''],
        ['[id]', REQUIRED, 'id'],
        ['[[page]]', OPTIONAL, 'page'],
        ['[...path]', REST, 'path'],
    ]

    test.each(CASES)('%s', (segment, kind, name) => {
        expect(classifyRouteSegment(segment)).toEqual({ kind, name })
    })

    // The ORDER rule, which is the part that is easy to get wrong and impossible to notice: `[[page]]`
    // also satisfies "starts with `[`, ends with `]`", so testing the plain form first would classify it
    // as a REQUIRED segment named `[page]`.
    test('an optional is not mistaken for a required named "[page]"', () => {
        expect(classifyRouteSegment('[[page]]').kind).toBe(OPTIONAL)
        expect(classifyRouteSegment('[[page]]').name).toBe('page')
    })

    test('a rest is not mistaken for a required named "...path"', () => {
        expect(classifyRouteSegment('[...path]').kind).toBe(REST)
        expect(classifyRouteSegment('[...path]').name).toBe('path')
    })

    // A malformed bracket is TEXT, not a guess. A typo should fail as "this route does not match"
    // rather than silently capturing a param under a mangled name.
    test.each([['[name'], ['name]'], ['[]'], [']name['], ['']])(
        'malformed %s is a literal',
        (segment) => {
            expect(classifyRouteSegment(segment).kind).toBe(LITERAL)
        },
    )

    // A degenerate EMPTY optional. `[[]]` is 4 characters, so it misses the `length > 4` optional guard
    // and falls through to the plain form as a required param literally named `[]`. Recorded rather than
    // fixed: this is the behaviour BOTH private copies had, and the extraction was verbatim on purpose —
    // changing it here would be a semantics change smuggled in under a de-duplication. It only matters
    // for a route that is nonsense either way, and both sides still agree, which is the actual contract.
    test('the degenerate `[[]]` is a required param named "[]" — both sides agree, which is the point', () => {
        expect(classifyRouteSegment('[[]]')).toEqual({ kind: REQUIRED, name: '[]' })
    })

    // The kind values double as the specificity rank `matchRoute` sorts on.
    test('kinds are ordered literal < required < optional < rest', () => {
        expect(LITERAL).toBeLessThan(REQUIRED)
        expect(REQUIRED).toBeLessThan(OPTIONAL)
        expect(OPTIONAL).toBeLessThan(REST)
    })
})

describe('url() and matchRoute() are inverses', () => {
    // The real contract. An href built from a pattern must match THAT pattern and recover the params it
    // was built from — which is precisely what a divergence between the two copies broke.
    test.each([
        ['/users/[id]', { id: '42' }, '/users/42'],
        ['/blog/[[page]]', { page: '2' }, '/blog/2'],
        ['/docs/[...path]', { path: 'a/b/c' }, '/docs/a/b/c'],
    ])('%s round-trips', (pattern, params, expectedHref) => {
        const href = url(pattern as never, params as never)
        expect(href).toBe(expectedHref)

        const matched = matchRoute([pattern], href)
        expect(matched?.pattern).toBe(pattern)
        expect(matched?.params).toEqual(params)
    })

    test('an omitted optional segment drops out of the href and still matches', () => {
        const href = url('/blog/[[page]]' as never, {} as never)
        expect(href).toBe('/blog')
        expect(matchRoute(['/blog/[[page]]'], href)?.pattern).toBe('/blog/[[page]]')
    })

    test('a literal path with no dynamic segment is untouched and matches itself', () => {
        const href = url('/about')
        expect(href).toBe('/about')
        expect(matchRoute(['/about'], href)?.pattern).toBe('/about')
    })
})
