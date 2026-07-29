// The keyed reconcile's PLAN, asserted as arithmetic.
//
// "A correctness test cannot guard a performance contract: when the contract is 'does less work',
// assert the work — the wrong implementation still produces the right output."
//
// `forReconcile.test.ts` asserts that end-to-end, by mounting a list and counting re-added `<li>`
// nodes through a `MutationObserver`. This asserts the same contract one layer down, where it is
// arithmetic rather than DOM: no happy-dom, no mount, no flush, and a failure names the algorithm
// instead of the rendering. It also reaches what a fuzz over plausible mutations reaches only by
// luck — an empty subsequence, a single survivor, an all-fresh list, duplicate positions.
//
// The cases are chosen to DISTINGUISH implementations, not to be representative: a full reverse is
// useless for that (every correct plan moves nearly everything), while a two-row swap separates a
// minimal plan from a cascading one by three orders of magnitude.

import { describe, expect, test } from 'bun:test'
import {
    increasingSubsequence,
    isAscending,
    keptInPlace,
    NEW_ITEM,
    plannedMoves,
} from './reconcilePlan.ts'

// The old positions a reconcile computes for a keyed list: for each item in the NEW order, where it
// used to be, or NEW_ITEM if it was built this pass.
const positionsFor = (before: readonly string[], after: readonly string[]): number[] =>
    after.map((key) => {
        const at = before.indexOf(key)
        return at === -1 ? NEW_ITEM : at
    })

const plan = (before: readonly string[], after: readonly string[]): number[] =>
    plannedMoves(positionsFor(before, after))

const rows = (count: number): string[] => Array.from({ length: count }, (_, i) => `r${i}`)

// ---------------------------------------------------------------------------
// The shapes that must cost nothing
// ---------------------------------------------------------------------------

describe('the ascending fast path moves only what was built', () => {
    test('an unchanged list moves nothing', () => {
        const list = rows(1000)
        expect(plan(list, list)).toEqual([])
    })

    test('a value-only update moves nothing — the keys did not move', () => {
        expect(plan(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([])
    })

    test('an append moves only the appended row', () => {
        expect(plan(['a', 'b', 'c'], ['a', 'b', 'c', 'd'])).toEqual([3])
    })

    test('a removal from the middle moves nothing — survivors stay ascending', () => {
        expect(plan(['a', 'b', 'c', 'd'], ['a', 'c', 'd'])).toEqual([])
    })

    test('a 1000-row list gaining one row plans exactly one move', () => {
        const before = rows(1000)
        expect(plan(before, [...before, 'new'])).toEqual([1000])
    })

    test('a prepend plans one move — the new row, not the 1000 it displaced', () => {
        // The survivors are all still ascending relative to one another; only the fresh row, which was
        // appended at the block end, has to be placed.
        const before = rows(1000)
        expect(plan(before, ['new', ...before])).toEqual([0])
    })
})

// ---------------------------------------------------------------------------
// The case that distinguishes implementations
// ---------------------------------------------------------------------------

describe('a two-row swap is not a rebuild', () => {
    test('swapping two adjacent rows of three plans ONE move', () => {
        // b and c exchange places. One of them can stay; the other moves.
        expect(plan(['a', 'b', 'c'], ['a', 'c', 'b'])).toHaveLength(1)
    })

    test('swapping two rows of a THOUSAND plans at most two moves', () => {
        // The naive back-to-front walk moved ~996 of 1000 here: displacing one row shifts the reference
        // its predecessor is compared against, and the mismatch cascades. No test of the rendered ORDER
        // can see it — both versions render the same list — which is why the guard is a count.
        const before = rows(1000)
        const after = [...before]
        after[100] = before[900] as string
        after[900] = before[100] as string
        expect(plan(before, after).length).toBeLessThanOrEqual(2)
    })

    test('swapping the two ENDS of a thousand plans at most two moves', () => {
        const before = rows(1000)
        const after = [...before]
        after[0] = before[999] as string
        after[999] = before[0] as string
        expect(plan(before, after).length).toBeLessThanOrEqual(2)
    })

    test('moving one row to the front plans one move', () => {
        const before = rows(100)
        const after = [before[57] as string, ...before.filter((_, i) => i !== 57)]
        expect(plan(before, after)).toEqual([0])
    })
})

describe('a reverse legitimately moves nearly everything', () => {
    test('reversing N rows plans N-1 moves — one row can always stay', () => {
        // Included as the CONTRAST: this is the case that cannot distinguish a good plan from a bad one,
        // which is why the swap cases above carry the contract instead.
        const before = rows(50)
        expect(plan(before, [...before].reverse())).toHaveLength(49)
    })
})

// ---------------------------------------------------------------------------
// increasingSubsequence — the off-by-one surface, directly
// ---------------------------------------------------------------------------

describe('increasingSubsequence', () => {
    test('an empty input yields an empty subsequence', () => {
        expect(increasingSubsequence([])).toEqual([])
    })

    test('a single element seeds the subsequence', () => {
        // The empty-tails case is spelled out in the implementation precisely because folding it into
        // the binary search compared against `undefined` and silently refused to seed — leaving the
        // subsequence permanently empty, so every item looked out of place and the whole list moved.
        expect(increasingSubsequence([7])).toEqual([0])
    })

    test('an all-NEW_ITEM input yields an empty subsequence', () => {
        expect(increasingSubsequence([NEW_ITEM, NEW_ITEM])).toEqual([])
    })

    test('an already-ascending run keeps every index', () => {
        expect(increasingSubsequence([0, 1, 2, 3])).toEqual([0, 1, 2, 3])
    })

    test('a descending run keeps exactly one index', () => {
        expect(increasingSubsequence([3, 2, 1, 0])).toHaveLength(1)
    })

    test('NEW_ITEM entries are never named — they must always be placed', () => {
        const kept = increasingSubsequence([0, NEW_ITEM, 1, NEW_ITEM, 2])
        expect(kept).toEqual([0, 2, 4])
    })

    test('the result is a longest subsequence, and it is increasing', () => {
        const positions = [2, 5, 3, 7, 11, 8, 10, 13, 6]
        const kept = increasingSubsequence(positions)
        // Increasing in BOTH index and position — an index list out of order would move the wrong rows.
        for (let i = 1; i < kept.length; i++) {
            expect(kept[i] as number).toBeGreaterThan(kept[i - 1] as number)
            expect(positions[kept[i] as number] as number).toBeGreaterThan(
                positions[kept[i - 1] as number] as number,
            )
        }
        expect(kept).toHaveLength(6) // 2,3,7,8,10,13
    })

    test('duplicate positions do not both survive — the subsequence is STRICTLY increasing', () => {
        // A non-unique `by` key can produce repeats. Keeping both would claim two rows are in the right
        // relative order when neither can be.
        const kept = increasingSubsequence([1, 1, 1])
        expect(kept).toHaveLength(1)
    })
})

// ---------------------------------------------------------------------------
// The fast-path predicate
// ---------------------------------------------------------------------------

describe('isAscending', () => {
    test.each([
        [[], true],
        [[0, 1, 2], true],
        [[NEW_ITEM, 0, NEW_ITEM, 1], true],
        [[1, 0], false],
        [[0, 2, 1], false],
    ] as const)('%j → %s', (positions, expected) => {
        expect(isAscending([...positions])).toBe(expected)
    })

    test('a NEW_ITEM between survivors does not break the run', () => {
        // A fresh row has no old position to be out of order with; treating NEW_ITEM as a position would
        // drop every insert off the fast path.
        expect(isAscending([0, NEW_ITEM, 1])).toBe(true)
    })
})

describe('keptInPlace', () => {
    test('the ascending case answers null — the sequence solve is skipped entirely', () => {
        expect(keptInPlace([0, 1, 2], true)).toBeNull()
    })

    test('the non-ascending case answers the subsequence', () => {
        expect(keptInPlace([1, 0], false)).toHaveLength(1)
    })
})
