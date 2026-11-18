import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import DealShortcuts from './DealShortcuts.abide'

// A key pressed where focus is — the page, or the field — and whether a shortcut took it.
function press(key: string, init: KeyboardEventInit = {}): boolean {
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
    })
    ;(document.activeElement ?? document.body).dispatchEvent(event)
    flushSync()
    return event.defaultPrevented
}

test('n opens a new deal, and an n typed in it stays in the field', async () => {
    using _keys = await mount(DealShortcuts({}))
    expect(press('n')).toBe(true)
    const field = document.querySelector('input')
    expect(document.activeElement).toBe(field)
    // Typed in the field, n is a letter: nothing is taken, nothing is built.
    let taken = true
    const work = measure(() => {
        taken = press('n')
    })
    expect(taken).toBe(false)
    atMost(work, { nodesCreated: 0, attributesSet: 0 })
    // An input method composing is not a shortcut either.
    field?.blur()
    expect(press('?', { isComposing: true })).toBe(false)
    expect(press('?')).toBe(true)
    expect(document.querySelectorAll('li')).toHaveLength(3)
    field?.focus()
    expect(press('Escape')).toBe(true)
    expect(document.querySelector('input')).toBeNull()
    expect(document.querySelector('li')).toBeNull()
})
