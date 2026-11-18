// `sortRows`, the order a sortable table's rows are in (RULEBOOK 51.45-51.50). What
// `SortableTable` renders from it is the CRM's tests', which mount it.

import { expect, test } from 'bun:test'

import { type Column, sortRows } from '#shared'

type Deal = { name: string; amount?: number | null; closes?: Date | string }

const AMOUNT: Column<Deal>[] = [{ key: 'amount', label: 'Amount' }]

const names = (rows: readonly Deal[]) => rows.map((row) => row.name)

// THE REVERT: drop the blank check from the comparator, and the blanks lead the descending order.
test('a blank value sorts last in both directions — 51.47', () => {
    const rows: Deal[] = [
        { name: 'a', amount: 3 },
        { name: 'none' },
        { name: 'b', amount: 10 },
        { name: 'null', amount: null },
        { name: 'nan', amount: Number.NaN },
        { name: 'c', amount: 2 },
    ]
    expect(
        names(
            sortRows(rows, AMOUNT, { key: 'amount', direction: 'ascending' }),
        ),
    ).toEqual(['c', 'a', 'b', 'none', 'null', 'nan'])
    expect(
        names(
            sortRows(rows, AMOUNT, { key: 'amount', direction: 'descending' }),
        ),
    ).toEqual(['b', 'a', 'c', 'none', 'null', 'nan'])
})

// THE REVERT: compare every value as text, and 10 sorts before 9 and the dates by their words.
test('numbers sort as numbers, dates by time and text by its words — 51.48', () => {
    const numbers: Deal[] = [
        { name: 'ten', amount: 10 },
        { name: 'nine', amount: 9 },
    ]
    expect(
        names(
            sortRows(numbers, AMOUNT, {
                key: 'amount',
                direction: 'ascending',
            }),
        ),
    ).toEqual(['nine', 'ten'])
    const CLOSES: Column<Deal>[] = [{ key: 'closes', label: 'Closes' }]
    const dates: Deal[] = [
        { name: 'january', closes: new Date('2027-01-01') },
        { name: 'invalid', closes: new Date('not a date') },
        { name: 'december', closes: new Date('2026-12-01') },
    ]
    expect(
        names(
            sortRows(dates, CLOSES, { key: 'closes', direction: 'ascending' }),
        ),
    ).toEqual(['december', 'january', 'invalid'])
    const NAME: Column<Deal>[] = [{ key: 'name', label: 'Name' }]
    const text: Deal[] = [{ name: 'deal 10' }, { name: 'Deal 9' }]
    expect(
        names(sortRows(text, NAME, { key: 'name', direction: 'ascending' })),
    ).toEqual(['Deal 9', 'deal 10'])
})

// THE REVERT: sort descending by reversing the ascending order, and the ties come out reversed.
test('rows of equal value keep the order they came in — 51.46', () => {
    const rows: Deal[] = [
        { name: 'first', amount: 5 },
        { name: 'low', amount: 1 },
        { name: 'second', amount: 5 },
        { name: 'third', amount: 5 },
    ]
    expect(
        names(
            sortRows(rows, AMOUNT, { key: 'amount', direction: 'descending' }),
        ),
    ).toEqual(['first', 'second', 'third', 'low'])
})

test('a column’s `value` is what it sorts by, and no sort hands the rows back — 51.49, 51.50', () => {
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
