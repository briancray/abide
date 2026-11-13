import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealStage from './DealStage.abide'

function press(label: string) {
    for (const button of document.querySelectorAll('button'))
        if (button.textContent === label) button.click()
    flushSync()
}

test('a closed deal is refused by name, and the page says why', async () => {
    using _stage = await mount(DealStage({}))
    press('d3')
    await Bun.sleep(400)
    press('lead')
    await Bun.sleep(50)
    expect(document.querySelector('.status')?.textContent).toBe(
        'Already won: A closed deal does not move.',
    )
})
