import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealToolbar from './DealToolbar.abide'

const bar = () => document.querySelector('[role=toolbar]') as HTMLElement
const items = () =>
    [...bar().querySelectorAll('[data-toolbar=item]')] as HTMLElement[]
const named = (text: string) =>
    items().find(
        (item) =>
            (item.textContent || item.getAttribute('aria-label')) === text,
    ) as HTMLElement
const stops = () =>
    items()
        .filter((item) => item.getAttribute('tabindex') === '0')
        .map((item) => item.textContent || item.getAttribute('aria-label'))
function key(target: HTMLElement, name: string) {
    const event = new KeyboardEvent('keydown', {
        key: name,
        bubbles: true,
        cancelable: true,
    })
    target.dispatchEvent(event)
    flushSync()
    return event.defaultPrevented
}
// Items register as they bind, and settle the tab stop a microtask after.
const settled = () => new Promise((resolve) => queueMicrotask(() => resolve(0)))

// 51.185, 51.186 — A TOOLBAR NAMED BY `label` IS ONE TAB STOP: its first item, every other out of
// the tab order. THE REVERT: leave every item's `tabindex` alone, and four are tab stops.
test('the toolbar is one tab stop, at its first item', async () => {
    using _toolbar = await mount(DealToolbar({}))
    await settled()
    expect(bar().getAttribute('aria-label')).toBe('Deal actions')
    expect(bar().getAttribute('aria-orientation')).toBe('horizontal')
    expect(stops()).toEqual(['Pin'])
    expect(items().map((item) => item.getAttribute('tabindex'))).toEqual([
        '0',
        '-1',
        '-1',
        '-1',
    ])
})

// 51.187 — THE ARROWS MOVE FOCUS between its items, passing over a disabled one and going
// round the ends, and Home and End reach the first and the last; the item focused is the tab stop.
// THE REVERT: rove every item, disabled or not, and ArrowRight from `Move to…` lands on `Archive`.
test('the arrow keys move focus along the items, round the ends, past a disabled one', async () => {
    using _toolbar = await mount(DealToolbar({}))
    await settled()
    named('Pin').focus()
    key(named('Pin'), 'ArrowRight')
    expect(document.activeElement?.textContent).toBe('Move to…')
    key(named('Move to…'), 'ArrowRight')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Note')
    expect(stops()).toEqual(['Note'])
    key(named('Pin'), 'ArrowLeft')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Note')
    key(named('Move to…'), 'Home')
    expect(document.activeElement?.textContent).toBe('Pin')
    key(named('Pin'), 'End')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Note')
})

// 51.186 — FOCUS REACHING AN ITEM ANY WAY makes it the tab stop, so Tab comes back to it. THE
// REVERT: drop `onfocusin`, and a click leaves the tab stop on `Pin`.
test('the item focused last is the one Tab comes back to', async () => {
    using _toolbar = await mount(DealToolbar({}))
    await settled()
    named('Move to…').focus()
    flushSync()
    expect(stops()).toEqual(['Move to…'])
})

// 51.188 — A KEY A CONTROL INSIDE IT TOOK, OR ONE TYPED INTO A FIELD, IS THE CONTROL'S: the menu's
// trigger opens on ArrowDown, and the arrows in the note move its caret. THE REVERT: rove on every
// arrow, and ArrowLeft in the note moves focus to `Move to…`.
test('a field keeps its arrow keys, and a menu trigger its own', async () => {
    using _toolbar = await mount(DealToolbar({}))
    await settled()
    const note = named('Note')
    note.focus()
    expect(key(note, 'ArrowLeft')).toBe(false)
    expect(document.activeElement).toBe(note)
    const trigger = named('Move to…')
    trigger.focus()
    key(trigger, 'ArrowDown')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement?.textContent).toBe('lead')
})
