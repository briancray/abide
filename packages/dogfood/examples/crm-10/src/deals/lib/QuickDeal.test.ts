import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import QuickDeal from './QuickDeal.abide'

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
