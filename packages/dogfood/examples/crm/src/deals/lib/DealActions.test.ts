import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import DealActions from './DealActions.abide'

const trigger = () =>
    document.querySelector('[data-part=trigger]') as HTMLButtonElement
const menu = () => document.querySelector('[role=menu]') as HTMLElement
const key = (target: Element, name: string) =>
    target.dispatchEvent(
        new KeyboardEvent('keydown', { key: name, bubbles: true }),
    )

test('the arrow keys skip the stage the deal is in', async () => {
    using _actions = await mount(DealActions({}))
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
    expect(document.activeElement?.textContent).toBe('won')
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
