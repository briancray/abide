import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount, settled } from '@abide/harness/abide'

import CloseCalendar from './CloseCalendar.abide'

const cell = (date: string) =>
    document.querySelector(`[role=gridcell][id$="-${date}"]`) as HTMLElement
const focused = () => (document.activeElement as HTMLElement).id.slice(-10)
const status = () => document.querySelector('.status')?.textContent?.trim()
function press(key: string) {
    ;(document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true }),
    )
    flushSync()
}

// 52.83, 52.88 — A MONTH OF WHOLE WEEKS under a header row of weekdays, each deal on the day it
// closes. December 2026 starts on a Tuesday, so its grid opens on November's last two days.
test('the month is whole weeks, each deal on the day it closes', async () => {
    using _calendar = await mount(CloseCalendar({}))
    await settled()
    expect(document.querySelector('[data-calendar=heading]')?.textContent).toBe(
        'December 2026',
    )
    const headers = [...document.querySelectorAll('[role=columnheader]')]
    expect(headers.map((header) => header.textContent)).toEqual([
        'Sun',
        'Mon',
        'Tue',
        'Wed',
        'Thu',
        'Fri',
        'Sat',
    ])
    const rows = document.querySelectorAll('[data-calendar=week]')
    expect(rows).toHaveLength(5)
    expect(rows[0]?.querySelector('[role=gridcell]')?.id).toEndWith(
        '2026-11-29',
    )
    expect(cell('2026-11-29').hasAttribute('data-outside')).toBe(true)
    expect(cell('2026-12-02').textContent).toContain('Hopper & Co expansion')
    expect(cell('2026-12-15').textContent).toContain(
        'Analytical Engines renewal',
    )
})

// 52.87, 52.89, 52.91, 52.92 — THE KEYS MOVE THE DAY, the month following it, and Enter picks it.
// THE REVERT: drop the month following the active day, and focus stays on December 29th.
test('the arrows move the day focused into the next month, and Enter picks it', async () => {
    using _calendar = await mount(CloseCalendar({}))
    await settled()
    expect(
        document.querySelectorAll('[role=gridcell][tabindex="0"]'),
    ).toHaveLength(1)
    cell('2026-12-01').focus()
    press('ArrowDown')
    press('ArrowDown')
    expect(focused()).toBe('2026-12-15')
    press('Enter')
    expect(status()).toBe('Analytical Engines renewal')
    press('ArrowDown')
    press('ArrowDown')
    press('ArrowDown')
    expect(focused()).toBe('2027-01-05')
    expect(document.querySelector('[data-calendar=heading]')?.textContent).toBe(
        'January 2027',
    )
    press('ArrowDown')
    press('ArrowDown')
    press('Enter')
    expect(focused()).toBe('2027-01-19')
    expect(status()).toBe('Nothing closes on 2027-01-19.')
})

// 52.93, 52.94, 52.96 — A CLICK PICKS A DAY, and the buttons page the month.
test('a click picks a day, and the buttons page the month', async () => {
    using _calendar = await mount(CloseCalendar({}))
    await settled()
    cell('2026-12-02').click()
    flushSync()
    expect(status()).toBe('Hopper & Co expansion')
    expect(cell('2026-12-02').getAttribute('aria-selected')).toBe('true')
    expect(cell('2026-12-02').hasAttribute('data-selected')).toBe(true)
    ;(document.querySelector('[data-calendar=next]') as HTMLElement).click()
    flushSync()
    expect(document.querySelector('[data-calendar=heading]')?.textContent).toBe(
        'January 2027',
    )
    expect(cell('2027-01-20').textContent).toContain('Langley Research seats')
})
