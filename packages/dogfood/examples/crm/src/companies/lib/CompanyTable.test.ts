import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount, settled } from '@abide/harness/abide'

import CompanyTable from './CompanyTable.abide'

const links = () =>
    [...document.querySelectorAll('tbody a')].map((link) => [
        link.textContent,
        link.getAttribute('href'),
    ])

test('a name links to its company, and sorts with its row', async () => {
    using _table = await mount(CompanyTable({}))
    await settled()
    expect(links()).toEqual([
        ['Analytical Engines', '/companies/analytical-engines'],
        ['Hopper & Co', '/companies/hopper-and-co'],
        ['Langley Research', '/companies/langley-research'],
    ])
    expect(document.querySelector('tbody td:nth-child(2)')?.textContent).toBe(
        'London',
    )
    for (const button of document.querySelectorAll('th button'))
        if (button.textContent === 'City') (button as HTMLElement).click()
    flushSync()
    expect(links().map(([name]) => name)).toEqual([
        'Hopper & Co',
        'Langley Research',
        'Analytical Engines',
    ])
})

// 51.60 — EACH ROW'S DETAIL IS A ROW OF ITS OWN UNDER IT, spanning the columns, and moves with it on a
// sort. THE REVERT: drop the `{#if Detail}` row from `SortableTable` — no detail row, and the
// three contacts are missing between the companies.
test("each company's contact sits in a row of its own under it, and sorts with it", async () => {
    using _table = await mount(CompanyTable({}))
    await settled()
    const pairs = () =>
        [...document.querySelectorAll('tbody tr')].map((row) =>
            row.getAttribute('data-part') === 'detail'
                ? row.textContent?.trim()
                : row.querySelector('a')?.textContent,
        )
    expect(
        document
            .querySelector('[data-part=detail] td')
            ?.getAttribute('colspan'),
    ).toBe('2')
    for (const button of document.querySelectorAll('th button'))
        if (button.textContent === 'City') (button as HTMLElement).click()
    flushSync()
    expect(pairs()).toEqual([
        'Hopper & Co',
        'Contact: Grace Hopper',
        'Langley Research',
        'Contact: Katherine Johnson',
        'Analytical Engines',
        'Contact: Ada Lovelace',
    ])
})
