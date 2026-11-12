import { afterEach, expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import { DEALS } from './DEALS.server.ts'
import QuickDeal from './QuickDeal.abide'

// One list for the app: take back the deal this adds
const before = DEALS.length
afterEach(() => {
    DEALS.splice(before)
})

test('the name clears once the deal is added, and not before', async () => {
    using _form = await mount(QuickDeal({}))
    const input = document.querySelector('input') as HTMLInputElement
    document.querySelector('button')?.click()
    flushSync()
    expect(input.value).toBe('Support renewal')
    await Bun.sleep(50)
    flushSync()
    expect(input.value).toBe('')
    expect(document.querySelector('.status')?.textContent).toBe(
        'Added Support renewal',
    )
})
