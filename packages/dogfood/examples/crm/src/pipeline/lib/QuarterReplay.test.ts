import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import QuarterReplay from './QuarterReplay.abide'

const root = () => document.querySelector('[data-playback=root]') as HTMLElement
const status = () => document.querySelector('.status')?.textContent
const key = (name: string) => {
    root().dispatchEvent(
        new KeyboardEvent('keydown', { key: name, bubbles: true }),
    )
    flushSync()
}

test('the keys and the scrubber move the replay, and the speeds pick its rate', async () => {
    using _replay = await mount(QuarterReplay({}))
    expect(status()).toBe('Week 1: $0 won')
    key('ArrowRight')
    key('ArrowRight')
    key('ArrowRight')
    expect(status()).toBe('Week 4: $20,500 won')
    const scrubber = document.querySelector(
        'input[type=range]',
    ) as HTMLInputElement
    scrubber.value = '6500'
    scrubber.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(status()).toBe('Week 7: $54,500 won')
    const twice = [...document.querySelectorAll('[role=radio]')].find(
        (button) => button.textContent === '2×',
    ) as HTMLButtonElement
    twice.click()
    flushSync()
    expect(twice.getAttribute('aria-checked')).toBe('true')
    key(' ')
    expect(
        document
            .querySelector('[data-playback=play]')
            ?.getAttribute('aria-pressed'),
    ).toBe('true')
    key(' ')
})
