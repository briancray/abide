// `sortBy`, the order a list is in by a value of each item (RULEBOOK 51.45-51.48, 51.50), and the
// order `sortableTable` reads a column's value in (51.49). What `SortableTable` renders from it is the
// CRM's tests', which mount it.

import { expect, test } from 'bun:test'

import { type Column, sortBy } from '#shared'
import { sortRows } from '#shared/sortRows.ts'

type Deal = { name: string; amount?: number | null; closes?: Date | string }

const names = (deals: readonly Deal[]) => deals.map((deal) => deal.name)
const amount = (deal: Deal) => deal.amount

// THE REVERT: drop the blank check from the comparator, and the blanks lead the descending order.
test('a blank value sorts last in both directions — 51.47', () => {
    const deals: Deal[] = [
        { name: 'a', amount: 3 },
        { name: 'none' },
        { name: 'b', amount: 10 },
        { name: 'null', amount: null },
        { name: 'nan', amount: Number.NaN },
        { name: 'c', amount: 2 },
    ]
    expect(names(sortBy(deals, amount))).toEqual([
        'c',
        'a',
        'b',
        'none',
        'null',
        'nan',
    ])
    expect(names(sortBy(deals, amount, 'descending'))).toEqual([
        'b',
        'a',
        'c',
        'none',
        'null',
        'nan',
    ])
})

// THE REVERT: compare every value as text, and 10 sorts before 9 and the dates by their words.
test('numbers sort as numbers, dates by time and text by its words — 51.48', () => {
    const numbers: Deal[] = [
        { name: 'ten', amount: 10 },
        { name: 'nine', amount: 9 },
    ]
    expect(names(sortBy(numbers, amount))).toEqual(['nine', 'ten'])
    const dates: Deal[] = [
        { name: 'january', closes: new Date('2027-01-01') },
        { name: 'invalid', closes: new Date('not a date') },
        { name: 'december', closes: new Date('2026-12-01') },
    ]
    expect(names(sortBy(dates, (deal) => deal.closes))).toEqual([
        'december',
        'january',
        'invalid',
    ])
    const text: Deal[] = [{ name: 'deal 10' }, { name: 'Deal 9' }]
    expect(names(sortBy(text, (deal) => deal.name))).toEqual([
        'Deal 9',
        'deal 10',
    ])
})

// THE REVERT: sort descending by reversing the ascending order, and the ties come out reversed.
test('items of equal value keep the order they came in — 51.46', () => {
    const deals: Deal[] = [
        { name: 'first', amount: 5 },
        { name: 'low', amount: 1 },
        { name: 'second', amount: 5 },
        { name: 'third', amount: 5 },
    ]
    expect(names(sortBy(deals, amount, 'descending'))).toEqual([
        'first',
        'second',
        'third',
        'low',
    ])
})

// THE REVERT: sort `items` in place, and the list handed in comes back reordered.
test('a sort is a new list, the one handed in left as it is — 51.50', () => {
    const deals: Deal[] = [
        { name: 'b', amount: 2 },
        { name: 'a', amount: 1 },
    ]
    const sorted = sortBy(deals, amount)
    expect(sorted).not.toBe(deals)
    expect(names(deals)).toEqual(['b', 'a'])
})

test('a column’s `value` is what a table sorts by, and no sort keeps its rows — 51.49, 51.51', () => {
    const rows: Deal[] = [
        { name: 'proposal', amount: 1 },
        { name: 'lead', amount: 2 },
    ]
    const STAGE: Column<Deal>[] = [
        {
            key: 'stage',
            label: 'Stage',
            value: (deal) => ['lead', 'proposal'].indexOf(deal.name),
        },
    ]
    expect(
        names(sortRows(rows, STAGE, { key: 'stage', direction: 'ascending' })),
    ).toEqual(['lead', 'proposal'])
    expect(sortRows(rows, STAGE, undefined)).toBe(rows)
    expect(sortRows(rows, STAGE, { key: 'gone', direction: 'ascending' })).toBe(
        rows,
    )
})
