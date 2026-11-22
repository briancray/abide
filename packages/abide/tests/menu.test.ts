// 50.37 — `menu`'s `open`, written by the app and by every way the menu closes, and what hears it.
// The parts are spread by hand here, as 32.11 spreads them: an attribute per string, a listener per
// `on<event>`. What a template does with them is the CRM's tests'.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, menu, reactive } from '#shared'

afterEach(() => document.body.replaceChildren())

function spread(element: HTMLElement, part: Record<string, unknown>): void {
    for (const name of Object.keys(part)) {
        const value = part[name]
        if (name.startsWith('on'))
            element.addEventListener(name.slice(2), value as EventListener)
        else if (typeof value === 'string') element.setAttribute(name, value)
    }
}

function built(open = reactive(false)) {
    const heard: string[] = []
    const parts = menu({
        open,
        onopen: () => heard.push('open'),
        onclose: () => heard.push('close'),
    })
    const trigger = document.createElement('button')
    const list = document.createElement('div')
    list.innerHTML = '<button role="menuitem">archive</button>'
    spread(trigger, parts.trigger)
    spread(list, parts.menu)
    document.body.append(trigger, list)
    return { open, heard, list }
}

// THE REVERT: drop the watch on `open`, and the app writing it opens nothing.
test('open written by the app opens and closes the menu, and each is heard — 50.37', () => {
    const { open, heard, list } = built()
    open.set(true)
    flushSync()
    expect(list.matches(':popover-open')).toBe(true)
    open.set(false)
    flushSync()
    expect(list.matches(':popover-open')).toBe(false)
    expect(heard).toEqual(['open', 'close'])
})

test('a pick closes the menu and writes false to open — 50.31, 50.37', () => {
    const { open, heard, list } = built()
    open.set(true)
    flushSync()
    ;(list.querySelector('[role=menuitem]') as HTMLElement).click()
    expect(list.matches(':popover-open')).toBe(false)
    expect(open.peek()).toBe(false)
    expect(heard).toEqual(['open', 'close'])
})

// A menu with its two parts spread, from `options`, the trigger and the menu in the document.
function standing(options: Parameters<typeof menu>[0]) {
    const parts = menu(options)
    const trigger = document.createElement('button')
    const list = document.createElement('div')
    list.innerHTML = '<button role="menuitem">archive</button>'
    spread(trigger, parts.trigger)
    spread(list, parts.menu)
    document.body.append(trigger, list)
    const enter = (target: HTMLElement, pointerType = 'mouse') =>
        target.dispatchEvent(new PointerEvent('pointerenter', { pointerType }))
    const leave = (target: HTMLElement) =>
        target.dispatchEvent(
            new PointerEvent('pointerleave', { pointerType: 'mouse' }),
        )
    const isOpen = () => list.matches(':popover-open')
    return { parts, trigger, list, enter, leave, isOpen }
}

// THE REVERT: drop the `openOnHover` timer from the trigger's `pointerenter`, and a resting mouse opens
// nothing.
test('a mouse resting on the trigger opens the menu after openOnHover, and a touch does not — 50.57', async () => {
    const hover = standing({ openOnHover: 5 })
    hover.enter(hover.trigger, 'touch')
    await Bun.sleep(15)
    expect(hover.isOpen()).toBe(false)
    hover.enter(hover.trigger)
    expect(hover.isOpen()).toBe(false)
    await Bun.sleep(15)
    expect(hover.isOpen()).toBe(true)
    // A pointer opening it leaves focus where it was.
    expect(document.activeElement === hover.list.firstElementChild).toBe(false)
})

// THE REVERT: arm the leave whatever opened the menu, and the one a key opened closes under a pointer
// that left.
test('a menu a pointer opened closes once the pointer has left trigger and menu, and comes back to keep it — 50.58', async () => {
    const leaves = standing({ closeOnLeave: 5 })
    leaves.trigger.dispatchEvent(new MouseEvent('click', { detail: 1 }))
    expect(leaves.isOpen()).toBe(true)
    leaves.leave(leaves.trigger)
    leaves.enter(leaves.list)
    await Bun.sleep(15)
    expect(leaves.isOpen()).toBe(true)
    leaves.leave(leaves.list)
    await Bun.sleep(15)
    expect(leaves.isOpen()).toBe(false)
    // Opened from a key — a click with no pointer under it — a leave closes nothing.
    leaves.trigger.dispatchEvent(new MouseEvent('click', { detail: 0 }))
    leaves.leave(leaves.trigger)
    await Bun.sleep(15)
    expect(leaves.isOpen()).toBe(true)
})

// THE REVERT: drop the open-groupmate switch from the trigger's `pointerenter`, and the second menu
// waits for a click while the first stays open.
test('a group switches to the menu whose trigger the pointer enters, and the arrows step between them — 50.59', () => {
    const first = standing({ group: 'header' })
    const second = standing({ group: 'header' })
    first.trigger.dispatchEvent(new MouseEvent('click', { detail: 1 }))
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
    expect(alone.isOpen()).toBe(false)
})
