import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealMenubar from './DealMenubar.abide'

const bar = () => document.querySelector('[role=menubar]') as HTMLElement
const triggers = () =>
    [...bar().querySelectorAll('[role=menuitem]')] as HTMLElement[]
const trigger = (text: string) =>
    triggers().find((each) => each.textContent === text) as HTMLElement
const open = () =>
    [...document.querySelectorAll('[role=menu]')].filter((each) =>
        each.matches(':popover-open'),
    )
function key(target: Element, name: string) {
    target.dispatchEvent(
        new KeyboardEvent('keydown', {
            key: name,
            bubbles: true,
            cancelable: true,
        }),
    )
    flushSync()
}
const settled = () => new Promise((resolve) => queueMicrotask(() => resolve(0)))

// 51.189 — A MENUBAR'S ITEMS ARE MENU ITEMS, each opening its menu, and the bar is one tab stop.
// THE REVERT: give a menubar's item no role, and its triggers read as buttons.
test('a menubar holds menu items opening menus, one of them a tab stop', async () => {
    using _bar = await mount(DealMenubar({}))
    await settled()
    expect(bar().getAttribute('aria-label')).toBe('Deal')
    expect(triggers().map((each) => each.textContent)).toEqual([
        'Stage',
        'View',
    ])
    expect(trigger('Stage').getAttribute('aria-haspopup')).toBe('menu')
    expect(triggers().map((each) => each.getAttribute('tabindex'))).toEqual([
        '0',
        '-1',
    ])
})

// 51.187, 50.32 — ALONG THE BAR, THE ARROWS MOVE FOCUS between its menus' items without opening
// them, and ArrowDown opens the menu of the one focused. THE REVERT: drop the menubar's keys, and
// ArrowRight leaves focus on `Stage`.
test('the arrows walk the bar, and ArrowDown opens a menu', async () => {
    using _bar = await mount(DealMenubar({}))
    await settled()
    trigger('Stage').focus()
    key(trigger('Stage'), 'ArrowRight')
    expect(document.activeElement).toBe(trigger('View'))
    expect(open()).toEqual([])
    key(trigger('View'), 'ArrowDown')
    expect(trigger('View').getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement?.textContent).toBe('board')
})

// 50.57, 50.31 — WHILE ONE IS OPEN, THE ARROWS ACROSS SWITCH TO THE NEXT MENU, and Escape hands focus
// back to the bar at that menu's item, which Tab then reaches. THE REVERT: hand the menus no `group`,
// and ArrowRight in the open menu switches to nothing.
test('an open menu switches to the next on ArrowRight, and Escape returns to the bar', async () => {
    using _bar = await mount(DealMenubar({}))
    await settled()
    trigger('Stage').focus()
    key(trigger('Stage'), 'ArrowDown')
    expect(document.activeElement?.textContent).toBe('lead')
    key(document.activeElement as HTMLElement, 'ArrowRight')
    expect(open().length).toBe(1)
    expect(trigger('View').getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement?.textContent).toBe('board')
    key(document.activeElement as HTMLElement, 'Escape')
    expect(open()).toEqual([])
    expect(document.activeElement).toBe(trigger('View'))
    expect(triggers().map((each) => each.getAttribute('tabindex'))).toEqual([
        '-1',
        '0',
    ])
})
