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
