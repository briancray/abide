import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealSideMenus from './DealSideMenus.abide'

const trigger = (text: string) =>
    [...document.querySelectorAll('[role=menubar] [role=menuitem]')].find(
        (each) => each.textContent === text,
    ) as HTMLElement
const open = () =>
    [...document.querySelectorAll('[role=menu]')].filter((each) =>
        each.matches(':popover-open'),
    )
const focused = () => document.activeElement?.textContent
function key(name: string) {
    ;(document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', {
            key: name,
            bubbles: true,
            cancelable: true,
        }),
    )
    flushSync()
}
const settled = () => new Promise((resolve) => queueMicrotask(() => resolve(0)))

// 50.32, 51.187 — DOWN A VERTICAL MENUBAR, ArrowDown walks the bar and ArrowRight opens the menu to
// the right of the item focused. THE REVERT: open on ArrowDown whatever the side, and ArrowDown on
// `Stage` opens its menu rather than reaching `Owner`.
test('ArrowDown walks a vertical menubar, and ArrowRight opens a menu', async () => {
    using _bar = await mount(DealSideMenus({}))
    await settled()
    trigger('Stage').focus()
    key('ArrowDown')
    expect(focused()).toBe('Owner')
    expect(open().length).toBe(0)
    key('ArrowRight')
    expect(trigger('Owner').getAttribute('aria-expanded')).toBe('true')
    expect(focused()).toBe('Ada')
})

// 50.77 — ARROWLEFT, BACK TOWARD THE BAR, CLOSES A MENU OPENING TO THE RIGHT and hands focus to its
// item. THE REVERT: drop the arrow back from the menu's keys, and ArrowLeft switches to `Stage`'s menu.
test('ArrowLeft closes a menu opening to the right, back to the bar', async () => {
    using _bar = await mount(DealSideMenus({}))
    await settled()
    trigger('Owner').focus()
    key('ArrowRight')
    key('ArrowLeft')
    expect(open().length).toBe(0)
    expect(document.activeElement).toBe(trigger('Owner'))
})
