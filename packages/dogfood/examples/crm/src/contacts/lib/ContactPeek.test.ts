import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import ContactPeek from './ContactPeek.abide'

const name = () => document.querySelector('a') as HTMLAnchorElement
const card = () => document.querySelector('[popover]') as HTMLElement
const shown = () => card().matches(':popover-open')

function pointer(target: Element, type: string, pointerType = 'mouse') {
    target.dispatchEvent(new PointerEvent(type, { pointerType }))
    flushSync()
}

async function wait(ms: number) {
    await Bun.sleep(ms)
    flushSync()
}

// 50.55 — THE REVERT: drop the timer from the anchor's `pointerenter`, and a pointer resting on the
// name opens nothing.
test("a mouse resting on a contact's name opens the card, and a touch does not", async () => {
    using _peek = await mount(ContactPeek({}))
    pointer(name(), 'pointerenter', 'touch')
    await wait(350)
    expect(shown()).toBe(false)
    pointer(name(), 'pointerenter')
    await wait(100)
    expect(shown()).toBe(false)
    await wait(250)
    expect(shown()).toBe(true)
    expect(name().getAttribute('aria-expanded')).toBe('true')
})

// 50.56 — THE REVERT: drop the popover part's `pointerenter`, and moving from the name onto the card
// closes it under the pointer.
test('the card stays while the pointer moves onto it, and closes once it has left both', async () => {
    using _peek = await mount(ContactPeek({}))
    pointer(name(), 'pointerenter')
    await wait(350)
    pointer(name(), 'pointerleave')
    pointer(card(), 'pointerenter')
    await wait(250)
    expect(shown()).toBe(true)
    pointer(card(), 'pointerleave')
    await wait(250)
    expect(shown()).toBe(false)
})

// 50.75, 50.76 — THE REVERT: close a card focus opened on any `focusout`, and Tab onto its email
// link closes the card it is in.
test('focus on the name opens the card at once, and it stays until focus leaves both', async () => {
    using _peek = await mount(ContactPeek({}))
    const elsewhere = document.createElement('button')
    document.body.append(elsewhere)
    name().focus()
    flushSync()
    expect(shown()).toBe(true)
    // A leave closes only what a pointer opened.
    pointer(name(), 'pointerleave')
    await wait(250)
    expect(shown()).toBe(true)
    card().querySelector('a')?.focus()
    flushSync()
    expect(shown()).toBe(true)
    elsewhere.focus()
    flushSync()
    expect(shown()).toBe(false)
    elsewhere.remove()
})
