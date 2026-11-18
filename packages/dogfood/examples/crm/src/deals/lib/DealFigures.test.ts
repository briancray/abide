import { expect, spyOn, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealFigures from './DealFigures.abide'

const cells = () =>
    [...document.querySelectorAll('td')].map((cell) => cell.textContent)

// With the formatters built per call instead, adding the lead builds 2.
test('a lead with no amount reads as a dash, and builds nothing', async () => {
    using _figures = await mount(DealFigures({}))
    expect(cells()).toEqual([
        'Analytical Engines renewal',
        '$42,000',
        '60%',
        'Langley Research seats',
        '$15,000',
        '35%',
    ])
    const built = spyOn(Intl, 'NumberFormat')
    document.querySelector('button')?.click()
    flushSync()
    // Read before the restore, which clears what the spy recorded.
    const formatters = built.mock.calls.length
    built.mockRestore()
    expect(cells().slice(-3)).toEqual(['Babbage & Co', '—', '10%'])
    expect(document.querySelector('.tiles')?.textContent).toContain(
        '3 open deals',
    )
    expect(`formatters: ${formatters}`).toBe('formatters: 0')
})
