import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealSubmenu from './DealSubmenu.abide'

const menus = () => [...document.querySelectorAll('[role=menu]')]
const [outer, inner] = [
    () => menus()[0] as HTMLElement,
    () => menus()[1] as HTMLElement,
]
const isOpen = (menu: HTMLElement) => menu.matches(':popover-open')
const named = (text: string) =>
    [...document.querySelectorAll('button')].find(
        (each) => each.textContent === text,
    ) as HTMLButtonElement
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
function openActions() {
    named('Actions').focus()
    key('ArrowDown')
    expect(focused()).toBe('Move to')
}

// 50.78, 50.77 — A SUBMENU OPENS ON THE ARROW TOWARD ITS SIDE, and its items are its own: ArrowDown on
// its trigger walks the menu it is an item of. THE REVERT: count a submenu's items as the outer menu's
// too, and ArrowDown from `Move to` lands on `lead`.
test('ArrowRight opens a submenu, and ArrowDown walks past it', async () => {
    using _menu = await mount(DealSubmenu({}))
    openActions()
    key('ArrowDown')
    expect(focused()).toBe('Archive')
    expect(isOpen(inner())).toBe(false)
    key('ArrowUp')
    key('ArrowRight')
    expect(isOpen(inner())).toBe(true)
    expect(named('Move to').getAttribute('aria-expanded')).toBe('true')
    expect(focused()).toBe('lead')
    key('ArrowDown')
    expect(focused()).toBe('qualified')
})

// 50.77, 50.81 — THE ARROW BACK TOWARD ITS TRIGGER CLOSES A SUBMENU and hands focus to it, the menu
// it opened from standing open. THE REVERT: drop the `defaultPrevented` check in the menu's keys, and
// the outer menu, which the submenu stands inside, closes on the same Escape.
test('ArrowLeft or Escape closes the submenu alone', async () => {
    using _menu = await mount(DealSubmenu({}))
    openActions()
    key('ArrowRight')
    key('ArrowLeft')
    expect(isOpen(inner())).toBe(false)
    expect(isOpen(outer())).toBe(true)
    expect(focused()).toBe('Move to')
    key('ArrowRight')
    key('Escape')
    expect(isOpen(inner())).toBe(false)
    expect(isOpen(outer())).toBe(true)
    expect(focused()).toBe('Move to')
})

// 50.79 — A PICK IN A SUBMENU CLOSES EVERY MENU and hands focus to the outermost trigger, and a
// click on the item opening a submenu closes nothing. THE REVERT: close the submenu alone on a pick,
// and the outer menu stands open with focus on `Move to`.
test('a pick in a submenu closes every menu, and its trigger item opens it', async () => {
    using _menu = await mount(DealSubmenu({}))
    openActions()
    named('Move to').click()
    flushSync()
    expect(isOpen(outer())).toBe(true)
    expect(isOpen(inner())).toBe(true)
    named('won').click()
    flushSync()
    expect(isOpen(inner())).toBe(false)
    expect(isOpen(outer())).toBe(false)
    expect(document.activeElement).toBe(named('Actions'))
    expect(document.querySelector('.status')?.textContent).toBe('won')
})

// 50.80 — A MENU CLOSING CLOSES ITS SUBMENU. THE REVERT: drop the closing of submenus as a menu
// closes, and Escape on the outer menu leaves the submenu open over the page.
test('the outer menu closing closes its submenu', async () => {
    using _menu = await mount(DealSubmenu({}))
    openActions()
    named('Move to').click()
    flushSync()
    named('Move to').focus()
    key('Escape')
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(isOpen(outer())).toBe(false)
    expect(isOpen(inner())).toBe(false)
})
