import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import StageHints from './StageHints.abide'

const stage = (name: string) =>
    [...document.querySelectorAll<HTMLElement>('li > span')].find(
        (each) => each.textContent === name,
    ) as HTMLElement
const tip = () => document.querySelector('[role=tooltip]') as HTMLElement

test('a stage is described by its hint, with nothing written beside it', async () => {
    using _hints = await mount(StageHints({}))
    const proposal = stage('proposal')
    expect(proposal.getAttribute('aria-description')).toBe(
        'A quote is out, waiting on an answer.',
    )
    expect(proposal.parentElement?.children).toHaveLength(1)
    expect(document.querySelectorAll('[role=tooltip]')).toHaveLength(1)
})

test('focus opens the hint at once and Escape closes it', async () => {
    using _hints = await mount(StageHints({}))
    const proposal = stage('proposal')
    // A `focusin` that left focus elsewhere is not focus the browser shows (50.24).
    proposal.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    flushSync()
    expect(tip().matches(':popover-open')).toBe(false)
    proposal.focus()
    flushSync()
    expect(tip().matches(':popover-open')).toBe(true)
    expect(tip().hasAttribute('data-open')).toBe(true)
    expect(tip().textContent).toBe('A quote is out, waiting on an answer.')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    flushSync()
    expect(tip().matches(':popover-open')).toBe(false)
})

// THE REVERT: drop the delay, and passing over opens the hint.
test('a pointer resting on a stage opens its hint', async () => {
    using _hints = await mount(StageHints({}))
    const won = stage('won')
    won.dispatchEvent(
        new PointerEvent('pointerenter', { pointerType: 'mouse' }),
    )
    won.dispatchEvent(
        new PointerEvent('pointerleave', { pointerType: 'mouse' }),
    )
    await Bun.sleep(400)
    flushSync()
    expect(tip().matches(':popover-open')).toBe(false)
    won.dispatchEvent(
        new PointerEvent('pointerenter', { pointerType: 'mouse' }),
    )
    flushSync()
    expect(tip().matches(':popover-open')).toBe(false)
    await Bun.sleep(400)
    flushSync()
    expect(tip().matches(':popover-open')).toBe(true)
    expect(tip().textContent).toBe('Signed. It counts toward the target.')
    won.dispatchEvent(
        new PointerEvent('pointerleave', { pointerType: 'mouse' }),
    )
    flushSync()
    expect(tip().matches(':popover-open')).toBe(false)
})
