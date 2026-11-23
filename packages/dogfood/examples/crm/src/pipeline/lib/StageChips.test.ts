import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import StageChips from './StageChips.abide'

const chip = (stage: string) =>
    [
        ...document.querySelectorAll<HTMLButtonElement>('[role=group] button'),
    ].find((button) => button.textContent === stage) as HTMLButtonElement
const shown = () =>
    [...document.querySelectorAll('.fields strong')].map(
        (name) => name.textContent,
    )

test('each chip is pressed on its own, and the list keeps the stages pressed', async () => {
    using _chips = await mount(StageChips({}))
    expect(shown()).toHaveLength(4)
    chip('won').click()
    flushSync()
    expect(chip('won').getAttribute('aria-pressed')).toBe('true')
    expect(shown()).toEqual(['Hopper expansion'])
    chip('lead').click()
    flushSync()
    expect(shown()).toEqual(['Hopper expansion', 'Lovelace audit'])
    // Every chip is its own stop in the tab order.
    expect(chip('lead').hasAttribute('tabindex')).toBe(false)
    chip('won').click()
    flushSync()
    expect(chip('won').getAttribute('aria-pressed')).toBe('false')
    expect(shown()).toEqual(['Lovelace audit'])
})
