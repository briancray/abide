// The soft-nav layout-keep rule: whose number wins, and what bounds it.
//
// This lived six levels inside `dispatch` — in a `try`, in a page-match branch, in a non-rpc branch, in
// the request pipeline — so reaching it meant booting a server and crafting a header. `layout.test.ts`
// tested `applicableLayoutPrefixes` directly and never the clamp; `nav.test.ts` asserted the header the
// client SENDS and never what the server does with an over-count. It is four numbers and two rules.

import { describe, expect, test } from 'bun:test'
import { commonPrefixLength } from '../../shared/internal/commonPrefixLength.ts'
import { navKeepLevels } from './navKeepLevels.ts'

describe('whose number wins', () => {
    test('with no declared number, the route table derivation is the answer', () => {
        // A browser too old to send `Abide-Nav-Keep`, a crawler, a hand-issued header.
        expect(navKeepLevels(null, 2, 5)).toBe(2)
    })

    test('a declared number BEATS the derivation, even when it is smaller', () => {
        // Only the client knows what a LIVE page can keep: whether a chain is mounted, claimed, or
        // carries a graftSuffix. The derivation answers what the route table PERMITS, which is static.
        expect(navKeepLevels(1, 3, 5)).toBe(1)
    })

    test('a declared ZERO is a real answer, not an absence', () => {
        // A same-URL nav sends 0 so the whole tree renders and the seed carries the kept layouts' reads
        // — which is what makes clicking the page you are on refresh all of it. Treating 0 as "unset"
        // would silently fall back to the derivation and keep everything.
        expect(navKeepLevels(0, 4, 5)).toBe(0)
    })
})

describe('the clamp', () => {
    test('a declared over-count is clamped to the destination depth', () => {
        // Unclamped, this slices past the end of the level list and ships an EMPTY SHELL — a blank page
        // from a well-formed request. The header is attacker-supplied on any request reaching the route.
        expect(navKeepLevels(99, 0, 2)).toBe(2)
    })

    test('a destination with NO layouts clamps every declared number to zero', () => {
        expect(navKeepLevels(3, 0, 0)).toBe(0)
    })

    test('the DERIVATION is not clamped — it is already bounded by both chains', () => {
        // `sharedLayoutDepth` is a common-prefix length over the two prefix lists, so it can never
        // exceed the destination's own depth. Clamping it too would be harmless but would hide that.
        const from = ['a', 'b', 'c']
        const to = ['a', 'b']
        const derived = commonPrefixLength(from, to)
        expect(derived).toBe(2)
        expect(navKeepLevels(null, derived, to.length)).toBe(derived)
    })
})

describe('commonPrefixLength', () => {
    test.each([
        [[], [], 0],
        [['a'], [], 0],
        [[], ['a'], 0],
        [['a', 'b'], ['a', 'b'], 2],
        [['a', 'b'], ['a', 'c'], 1],
        [['x'], ['y'], 0],
        [['a', 'b', 'c'], ['a', 'b'], 2],
    ] as const)('%j vs %j → %d', (a, b, expected) => {
        expect(commonPrefixLength([...a], [...b])).toBe(expected)
    })

    test('a DIVERGENCE stops the count — a later match does not resume it', () => {
        // The rule is a PREFIX, not a set intersection. Counting `['a','x','c']` against `['a','y','c']`
        // as 2 would keep a layout the destination does not have in that position.
        expect(commonPrefixLength(['a', 'x', 'c'], ['a', 'y', 'c'])).toBe(1)
    })

    test('it is symmetric', () => {
        expect(commonPrefixLength(['a', 'b'], ['a'])).toBe(commonPrefixLength(['a'], ['a', 'b']))
    })
})
