import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealPageWindow from './DealPageWindow.abide'

const deals = () =>
    [...document.querySelectorAll('li')].map((deal) => deal.textContent)
const listed = () =>
    [...document.querySelectorAll('nav > *')].map((each) => each.textContent)
const press = (label: string) => {
    for (const button of document.querySelectorAll('nav button'))
        if (button.textContent === label) (button as HTMLButtonElement).click()
    flushSync()
}

// 51.126, 51.127 — `link` of any page writes `page`, so the app's own window of numbers works
// without `items`.
// THE REVERT: walk `list.items` instead of the window, and the first and last pages and a gap come back.
test('a window of five pages slides with the page showing, no first, last or gap', async () => {
    using _pages = await mount(DealPageWindow({}))
    expect(listed()).toEqual(['Previous', '1', '2', '3', '4', '5', 'Next'])
    press('4')
    expect(deals()).toEqual(['Deal 10', 'Deal 11', 'Deal 12'])
    expect(listed()).toEqual(['Previous', '2', '3', '4', '5', '6', 'Next'])
    expect(document.querySelector('[aria-current=page]')?.textContent).toBe('4')
    press('Next')
    press('Next')
    press('Next')
    press('Next')
    expect(deals()).toEqual(['Deal 22', 'Deal 23'])
    expect(listed()).toEqual(['Previous', '4', '5', '6', '7', '8', 'Next'])
})
