import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount, settled } from '@abide/harness/abide'

import DealPicker from './DealPicker.abide'

test('picking a deal in the list shows it in the detail panel', async () => {
    using _picker = await mount(DealPicker({}))
    await settled()
    const selected = () => document.querySelector('strong')?.textContent
    expect(selected()).toBe('Analytical Engines renewal')

    for (const button of document.querySelectorAll('button'))
        if (button.textContent?.trim() === 'Langley Research seats')
            button.click()
    flushSync()
    expect(selected()).toBe('Langley Research seats')
})
