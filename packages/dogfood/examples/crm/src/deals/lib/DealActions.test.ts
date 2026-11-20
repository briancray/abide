import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import DealActions from './DealActions.abide'

const trigger = () =>
    document.querySelector('[aria-haspopup=menu]') as HTMLButtonElement
const menu = () => document.querySelector('[role=menu]') as HTMLElement
const key = (target: Element, name: string) =>
    target.dispatchEvent(
        new KeyboardEvent('keydown', { key: name, bubbles: true }),
    )

test('the arrow keys skip the stage the deal is in', async () => {
    using _actions = await mount(DealActions({}))
    expect(trigger().getAttribute('aria-controls')).toBe(menu().id)
    key(trigger(), 'ArrowDown')
    flushSync()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement?.textContent).toBe('lead')
    // Focus moves, and nothing in the menu is written to move it.
    const work = measure(() => key(menu(), 'ArrowDown'))
    expect(document.activeElement?.textContent).toBe('qualified')
    atMost(work, { attributesSet: 0, nodesCreated: 0, elementsMoved: 0 })
    // `proposal` is where the deal is, so it is passed over.
    key(menu(), 'ArrowDown')
    expect(document.activeElement?.textContent).toBe('won')
    key(menu(), 'Home')
    expect(document.activeElement?.textContent).toBe('lead')
    key(menu(), 'ArrowUp')
    expect(document.activeElement?.textContent).toBe('pin to the top')
    key(menu(), 'Escape')
    flushSync()
    expect(menu().matches(':popover-open')).toBe(false)
    expect(document.activeElement).toBe(trigger())
})

test('a pick moves the deal and hands focus back', async () => {
    using _actions = await mount(DealActions({}))
    trigger().click()
    flushSync()
    expect(menu().matches(':popover-open')).toBe(true)
    expect(menu().closest('[data-open]')).not.toBeNull()
    ;(document.activeElement as HTMLButtonElement).click()
    flushSync()
    expect(document.querySelector('.status')?.textContent).toBe('lead')
    expect(menu().matches(':popover-open')).toBe(false)
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger())
})

// THE REVERT: close on a pick of any item, and pinning shuts the menu under the pointer.
test('a checkbox item changes its state and leaves the menu open', async () => {
    using _actions = await mount(DealActions({}))
    trigger().click()
    flushSync()
    const pin = document.querySelector('[role=menuitemcheckbox]') as HTMLElement
    pin.click()
    flushSync()
    expect(pin.getAttribute('aria-checked')).toBe('true')
    expect(menu().matches(':popover-open')).toBe(true)
})

// THE REVERT: drop the typed text, and a letter moves nothing.
test('typing moves focus to the item whose text starts with it', async () => {
    using _actions = await mount(DealActions({}))
    key(trigger(), 'ArrowDown')
    flushSync()
    key(menu(), 'w')
    expect(document.activeElement?.textContent).toBe('won')
    // Letters typed together are one word; `proposal` is disabled, so `pi` finds the pin.
    await Bun.sleep(600)
    key(menu(), 'p')
    key(menu(), 'i')
    expect(document.activeElement?.textContent).toBe('pin to the top')
})

test('the server writes the menu shut, named by its trigger', async () => {
    using _actions = await mount(DealActions({}))
    expect(menu().getAttribute('popover')).toBe('auto')
    expect(menu().getAttribute('aria-labelledby')).toBe(trigger().id)
    expect(trigger().getAttribute('aria-controls')).toBe(menu().id)
})
