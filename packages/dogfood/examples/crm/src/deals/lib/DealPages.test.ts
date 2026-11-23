import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealPages from './DealPages.abide'

const deals = () =>
    [...document.querySelectorAll('li')].map((deal) => deal.textContent)
const listed = () =>
    [...document.querySelectorAll('nav > *')].map((each) => each.textContent)
const press = (label: string) => {
    for (const button of document.querySelectorAll('nav button'))
        if (button.textContent === label) (button as HTMLButtonElement).click()
    flushSync()
}

test('the deals turn a page at a time, the far pages folded', async () => {
    using _pages = await mount(DealPages({}))
    expect(deals()).toEqual(['Deal 1', 'Deal 2', 'Deal 3'])
    expect(listed()).toEqual(['Previous', '1', '2', '…', '8', 'Next'])
    press('8')
    expect(deals()).toEqual(['Deal 22', 'Deal 23'])
    expect(document.querySelector('[aria-current=page]')?.textContent).toBe('8')
    press('Next')
    expect(deals()).toEqual(['Deal 22', 'Deal 23'])
    press('Previous')
    expect(listed()).toEqual(['Previous', '1', '…', '6', '7', '8', 'Next'])
})
