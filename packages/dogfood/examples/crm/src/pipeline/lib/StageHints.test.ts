import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import StageHints from './StageHints.abide'

const stage = (name: string) =>
    [...document.querySelectorAll<HTMLElement>('li > span')].find(
        (each) => each.textContent === name,
    ) as HTMLElement
const tip = (anchor: HTMLElement) =>
    document.getElementById(
        anchor.getAttribute('aria-describedby') ?? '',
    ) as HTMLElement

test('focus opens the hint at once and Escape closes it', async () => {
    using _hints = await mount(StageHints({}))
    const proposal = stage('proposal')
    expect(tip(proposal).textContent).toBe(
        'A quote is out, waiting on an answer.',
    )
    proposal.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    flushSync()
    expect(tip(proposal).matches(':popover-open')).toBe(true)
    expect(tip(proposal).hasAttribute('data-open')).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    flushSync()
    expect(tip(proposal).matches(':popover-open')).toBe(false)
})

// THE REVERT: drop the delay, and passing over opens the hint.
test('a pointer resting on a stage opens its hint', async () => {
    using _hints = await mount(StageHints({}))
    const won = stage('won')
    won.dispatchEvent(new MouseEvent('mouseenter'))
    won.dispatchEvent(new MouseEvent('mouseleave'))
    await Bun.sleep(400)
    expect(tip(won).matches(':popover-open')).toBe(false)
    won.dispatchEvent(new MouseEvent('mouseenter'))
    expect(tip(won).matches(':popover-open')).toBe(false)
    await Bun.sleep(400)
    expect(tip(won).matches(':popover-open')).toBe(true)
    won.dispatchEvent(new MouseEvent('mouseleave'))
    expect(tip(won).matches(':popover-open')).toBe(false)
})
