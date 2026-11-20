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
