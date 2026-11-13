import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import Pipeline from './Pipeline.abide'

const status = () => document.querySelector('.status')?.textContent?.trim()
const total = () => document.querySelector('strong')?.textContent

test('a refresh is busy and still ready; a first load is not', async () => {
    using _pipeline = await mount(Pipeline({}))
    expect(status()).toBe('loading…')
    await Bun.sleep(500)
    expect([status(), total()]).toEqual(['', '$16,800'])
    document.querySelector('button')?.click()
    flushSync()
    // Busy and still ready: the figure on screen stays until the new one lands.
    expect([status(), total()]).toEqual(['refreshing…', '$16,800'])
})
