import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import StageKeys from './StageKeys.abide'

const pressed = () =>
    document.querySelector('[aria-pressed="true"]')?.textContent?.trim()

function press(key: string, code: string): void {
    document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }),
    )
    flushSync()
}

test('the number row picks a stage by where its keys sit, on any layout', async () => {
    using _keys = await mount(StageKeys({}))
    expect(pressed()).toBe('1 lead')
    press('3', 'Digit3')
    expect(pressed()).toBe('3 proposal')
    // A French keyboard types & on the 1 of the number row: still the first stage.
    press('&', 'Digit1')
    expect(pressed()).toBe('1 lead')
})
