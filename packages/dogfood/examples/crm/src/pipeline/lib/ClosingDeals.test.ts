import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount, settled } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import ClosingDeals from './ClosingDeals.abide'
import { DEALS } from './DEALS.server.ts'
import { STAGES } from './STAGES.ts'

const column = (index: number) =>
    [...document.querySelectorAll('tbody tr')].map(
        (row) => row.children[index]?.textContent,
    )

function sortBy(label: string) {
    for (const button of document.querySelectorAll('th button'))
        if (button.textContent === label) (button as HTMLElement).click()
    flushSync()
}

test('a deal with no close date sorts last both ways', async () => {
    using _deals = await mount(ClosingDeals({}))
    await settled()
    expect(column(3)).toEqual([
        '2026-10-30',
        '2026-12-02',
        '2026-12-15',
        '2027-01-20',
        '2027-02-10',
        '—',
        '—',
    ])
    sortBy('Closes')
    expect(column(3)).toEqual([
        '2027-02-10',
        '2027-01-20',
        '2026-12-15',
        '2026-12-02',
        '2026-10-30',
        '—',
        '—',
    ])
    expect(
        document.querySelector('[aria-sort]')?.getAttribute('aria-sort'),
    ).toBe('descending')
})

test('stage sorts in pipeline order, ties as they came', async () => {
    using _deals = await mount(ClosingDeals({}))
    await settled()
    sortBy('Stage')
    const byStage = DEALS.toSorted(
        (left, right) =>
            STAGES.indexOf(left.stage) - STAGES.indexOf(right.stage),
    )
    expect(column(0)).toEqual(byStage.map((deal) => deal.name))
})

test('a re-sort moves the rows, building and rewriting none', async () => {
    using _deals = await mount(ClosingDeals({}))
    await settled()
    sortBy('Amount')
    const rows = [...document.querySelectorAll('tbody tr')]
    const work = measure(() => sortBy('Amount'))
    // The full reverse, row for row: the same seven rows, in the other order.
    const reversed = [...document.querySelectorAll('tbody tr')]
    expect(
        reversed.every((row, at) => row === rows[rows.length - 1 - at]),
    ).toBe(true)
    atMost(work, { nodesCreated: 0, dataWrites: 0, elementsMoved: 6 })
})
