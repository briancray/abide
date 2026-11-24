import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import StageTour from './StageTour.abide'

const play = () =>
    [...document.querySelectorAll('button')].find(
        (button) => button.getAttribute('data-carousel') === 'play',
    ) as HTMLButtonElement
const current = () =>
    document.querySelector('[data-current]')?.getAttribute('aria-label')

// 53.75, 53.77 — THE TOUR ARRIVES PLAYING, AND ITS BUTTON PAUSES IT. THE REVERT: drop `autoplay` from the
// tour, and it arrives paused.
test('the tour arrives playing, and its button pauses and plays it', async () => {
    using _tour = await mount(StageTour({}))
    expect(play().getAttribute('aria-pressed')).toBe('true')
    expect(play().textContent).toBe('Pause')
    play().click()
    flushSync()
    expect(play().getAttribute('aria-pressed')).toBe('false')
    expect(play().textContent).toBe('Play')
    play().click()
    flushSync()
    expect(play().getAttribute('aria-pressed')).toBe('true')
    expect(current()).toBe('lead')
})
