import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealSections from './DealSections.abide'

const buttons = () => [...document.querySelectorAll('button')]
const hidden = () =>
    [...document.querySelectorAll('ul')].map((list) =>
        list.hasAttribute('hidden'),
    )

test('opening a section closes the one open', async () => {
    using _sections = await mount(DealSections({}))
    expect(hidden()).toEqual([false, true])
    ;(buttons()[1] as HTMLButtonElement).click()
    flushSync()
    expect(hidden()).toEqual([true, false])
    expect(document.querySelector('.status')?.textContent).toBe(
        'Open: contacts',
    )
    ;(buttons()[1] as HTMLButtonElement).click()
    flushSync()
    expect(hidden()).toEqual([true, true])
    expect(document.querySelector('.status')?.textContent).toBe('Open: none')
})
