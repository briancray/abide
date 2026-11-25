import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount, settled } from '@abide/harness/abide'

import ClosingMonth from './ClosingMonth.abide'

const heading = () => document.querySelector('h3')?.textContent
const days = () =>
    [...document.querySelectorAll('td')].map((day) => day.textContent)

// 52.82, 52.87, 52.93 — THE DATE MATH WITHOUT THE KEYBOARD: whole weeks under the weekdays, paged by
// the buttons, in a table no key walks.
// THE REVERT: spread `day.cell` on each day, and the table is a grid a keyboard tabs into.
test('a month of close dates is a table of whole weeks, paged by the buttons', async () => {
    using _month = await mount(ClosingMonth({}))
    await settled()
    expect(heading()).toBe('December 2026')
    expect(
        [...document.querySelectorAll('th')].map((day) => day.textContent),
    ).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
    expect(days()).toHaveLength(35)
    expect(days().slice(0, 4)).toEqual(['29', '30', '1', '2 · 1'])
    expect(days()).toContain('15 · 1')
    expect(
        document.querySelectorAll('[role=gridcell], td[tabindex]'),
    ).toHaveLength(0)
    ;(document.querySelector('[data-calendar=next]') as HTMLElement).click()
    flushSync()
    expect(heading()).toBe('January 2027')
    expect(days()).toContain('20 · 1')
})
