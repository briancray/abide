import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealDetail from './DealDetail.abide'

const shown = () => document.querySelector('strong')?.textContent

test('picking a deal loads the one its args name', async () => {
    using _detail = await mount(DealDetail({}))
    await Bun.sleep(400)
    expect(shown()).toBe('Engine renewal')
    for (const tab of document.querySelectorAll('button'))
        if (tab.textContent === 'd2') tab.click()
    flushSync()
    await Bun.sleep(400)
    expect(shown()).toBe('Compiler pilot')
})
