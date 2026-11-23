// 50.28-50.39, 50.55-50.57 — `menu` and the popover it opens in. The parts are spread by hand here, as
// 32.11 spreads them: an attribute per string, a listener per `on<event>`, and the element handed to
// `bind:element`. What a template does with them is the CRM's tests'.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, menu } from '#shared'
import type { MenuOptions } from '#shared/menu.ts'

import { bindPart } from './bindPart.ts'

// What each test bound, let go after it: an open popover is a layer on `dismissible`'s stack (50.60).
const bound: (() => void)[] = []
afterEach(() => {
    for (const release of bound.splice(0)) release()
    document.body.replaceChildren()
})

// Every part in `parts` spread on `element`, in order, as a template spreads two on one element.
function spread(
    element: HTMLElement,
    ...parts: Record<string, unknown>[]
): HTMLElement {
    for (const part of parts)
        for (const name of Object.keys(part)) {
            const value = part[name]
            if (name === 'bind:element') bound.push(bindPart(part, element))
            // 32.95 — a listener object carries its own options.
            else if (name.startsWith('on'))
                element.addEventListener(
                    name.slice(2),
                    value as EventListener,
                    typeof value === 'object'
                        ? (value as AddEventListenerOptions)
                        : undefined,
                )
            else if (typeof value === 'string')
                element.setAttribute(name, value)
        }
    return element
}

// A menu with its two parts spread, the trigger and the menu in the document.
function standing(options: MenuOptions = {}) {
    const parts = menu(options)
    const trigger = document.createElement('button')
    const list = document.createElement('div')
    list.innerHTML = '<button role="menuitem">archive</button>'
    document.body.append(trigger, list)
    spread(trigger, parts.trigger)
    spread(list, parts.menu)
    const enter = (target: HTMLElement, pointerType = 'mouse') =>
        target.dispatchEvent(new PointerEvent('pointerenter', { pointerType }))
    const leave = (target: HTMLElement) =>
        target.dispatchEvent(
            new PointerEvent('pointerleave', { pointerType: 'mouse' }),
        )
    const isOpen = () => list.matches(':popover-open')
    const click = (detail: number) => {
        trigger.dispatchEvent(new MouseEvent('click', { detail }))
        flushSync()
    }
    return { parts, trigger, list, enter, leave, isOpen, click }
}

// THE REVERT: drop the focus from the menu's `toggle`, and the menu the app opens leaves focus on the
// page.
test('open written by the app opens the menu at its first item, and closes it — 50.28, 50.37', () => {
    const { parts, list, isOpen } = standing()
    parts.open.set(true)
    flushSync()
    expect(isOpen()).toBe(true)
    expect(document.activeElement).toBe(list.firstElementChild)
    parts.open.set(false)
    flushSync()
    expect(isOpen()).toBe(false)
})

test('a pick closes the menu, writes false to open and hands focus back — 50.31', () => {
    const { parts, list, trigger, isOpen } = standing()
    parts.open.set(true)
    flushSync()
    ;(list.querySelector('[role=menuitem]') as HTMLElement).click()
    flushSync()
    expect(isOpen()).toBe(false)
    expect(parts.open.peek()).toBe(false)
    expect(document.activeElement).toBe(trigger)
})

// THE REVERT: hear the pick as the click bubbles rather than as it is captured, and a pick whose own
// handler disables it — the stage a deal moves to is no longer offered — leaves the menu open.
test('a pick whose own handler disables it still closes the menu — 50.31', () => {
    const { parts, list, isOpen } = standing()
    parts.open.set(true)
    flushSync()
    const item = list.querySelector('[role=menuitem]') as HTMLButtonElement
    item.addEventListener('click', () => {
        item.disabled = true
    })
    item.click()
    flushSync()
    expect(isOpen()).toBe(false)
    expect(parts.open.peek()).toBe(false)
})

// THE REVERT: drop the menu's own Escape, and `dismissible`'s stack closes the popover with focus left
// on the item inside it.
test('Escape in the menu closes it and hands focus back to the trigger — 50.31', () => {
    const { parts, trigger, isOpen } = standing()
    parts.open.set(true)
    flushSync()
    const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
    })
    ;(document.activeElement as HTMLElement).dispatchEvent(escape)
    flushSync()
    expect(escape.defaultPrevented).toBe(true)
    expect(isOpen()).toBe(false)
    expect(document.activeElement).toBe(trigger)
})

// THE REVERT: drop the `openOnHover` timer from the trigger's `pointerenter`, and a resting mouse opens
// nothing.
test('a mouse resting on the trigger opens the menu after openOnHover, and a touch does not — 50.55', async () => {
    const hover = standing({ openOnHover: 5 })
    hover.enter(hover.trigger, 'touch')
    await Bun.sleep(15)
    flushSync()
    expect(hover.isOpen()).toBe(false)
    hover.enter(hover.trigger)
    expect(hover.isOpen()).toBe(false)
    await Bun.sleep(15)
    flushSync()
    expect(hover.isOpen()).toBe(true)
    // A pointer opening it leaves focus where it was.
    expect(document.activeElement === hover.list.firstElementChild).toBe(false)
})

// THE REVERT: arm the leave whatever opened the menu, and the one a key opened closes under a pointer
// that left.
test('a menu a pointer opened closes once the pointer has left trigger and menu, and comes back to keep it — 50.56', async () => {
    const leaves = standing({ closeOnLeave: 5 })
    leaves.click(1)
    expect(leaves.isOpen()).toBe(true)
    leaves.leave(leaves.trigger)
    leaves.enter(leaves.list)
    await Bun.sleep(15)
    flushSync()
    expect(leaves.isOpen()).toBe(true)
    leaves.leave(leaves.list)
    await Bun.sleep(15)
    flushSync()
    expect(leaves.isOpen()).toBe(false)
    // Opened from a key — a click with no pointer under it — a leave closes nothing.
    leaves.click(0)
    expect(leaves.isOpen()).toBe(true)
    leaves.leave(leaves.trigger)
    await Bun.sleep(15)
    flushSync()
    expect(leaves.isOpen()).toBe(true)
})

// THE REVERT: drop the open-groupmate switch from the trigger's `pointerenter`, and the second menu
// waits for a click while the first stays open.
test('a group switches to the menu whose trigger the pointer enters, and the arrows step between them — 50.57', () => {
    const first = standing({ group: 'header' })
    const second = standing({ group: 'header' })
    first.click(1)
    expect(first.isOpen()).toBe(true)
    second.enter(second.trigger)
    flushSync()
    expect([first.isOpen(), second.isOpen()]).toEqual([false, true])
    expect([
        second.parts.menu['data-from'],
        first.parts.menu['data-to'],
    ]).toEqual(['start', 'end'])
    second.list.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    )
    flushSync()
    expect([first.isOpen(), second.isOpen()]).toEqual([true, false])
    expect([
        first.parts.menu['data-from'],
        second.parts.menu['data-to'],
    ]).toEqual(['end', 'start'])
    // A menu outside the group switches nothing.
    const alone = standing({})
    alone.enter(alone.trigger)
    flushSync()
    expect(alone.isOpen()).toBe(false)
})
