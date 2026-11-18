import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import QuickEdit from './QuickEdit.abide'

function pressOn(target: Element) {
    target.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true }),
    )
    flushSync()
}

function button(): HTMLButtonElement {
    return document.querySelector('button') as HTMLButtonElement
}

test('a press outside the panel closes it, and a press inside does not', async () => {
    using _edit = await mount(QuickEdit({}))
    button().click()
    flushSync()
    pressOn(document.querySelector('input') as Element)
    expect(document.querySelector('form')).not.toBeNull()
    // The button that opened it is inside: its own click closes it, once.
    pressOn(button())
    expect(document.querySelector('form')).not.toBeNull()
    button().click()
    flushSync()
    expect(document.querySelector('form')).toBeNull()
    button().click()
    flushSync()
    pressOn(document.querySelector('strong') as Element)
    expect(document.querySelector('form')).toBeNull()
    expect(button().textContent?.trim()).toBe('Quick edit')
})

test('Escape closes it, and leaves the page its Escape once it is gone', async () => {
    using _edit = await mount(QuickEdit({}))
    button().click()
    flushSync()
    const escape = () => {
        const event = new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
        })
        ;(document.querySelector('input') ?? document.body).dispatchEvent(event)
        flushSync()
        return event.defaultPrevented
    }
    expect(escape()).toBe(true)
    expect(document.querySelector('form')).toBeNull()
    expect(escape()).toBe(false)
})
