import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealFloor from './DealFloor.abide'

const cover = () => document.querySelector('button') as HTMLButtonElement
const price = () => document.querySelector('span') as HTMLElement

test('the price is hidden behind its cover until the cover is pressed', async () => {
    using _floor = await mount(DealFloor({}))
    expect(price().hidden).toBe(true)
    expect(cover().hidden).toBe(false)
    cover().focus()
    cover().click()
    flushSync()
    await Promise.resolve()
    expect([price().hidden, cover().hidden]).toEqual([false, true])
    expect(price().hasAttribute('data-open')).toBe(true)
    expect(document.activeElement).toBe(price())
})
