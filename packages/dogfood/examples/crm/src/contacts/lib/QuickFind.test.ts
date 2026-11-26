import { expect, test } from 'bun:test'

import { mount } from '@abide/harness/abide'

import QuickFind from './QuickFind.abide'

// Whether a `/` pressed anywhere in the page was taken as the shortcut.
function pressSlash(): boolean {
    const event = new KeyboardEvent('keydown', { key: '/', cancelable: true })
    dispatchEvent(event)
    return event.defaultPrevented
}

test('/ focuses the search box until the box leaves', async () => {
    {
        using _find = await mount(QuickFind({}))
        expect(pressSlash()).toBe(true)
        expect(document.activeElement).toBe(document.querySelector('input'))
    }
    // Unmounted, the window keeps no listener of the component's.
    expect(pressSlash()).toBe(false)
})

// 53.7 — A `/` TYPED INTO ANOTHER FIELD IS THE FIELD'S. THE REVERT: the hand-written listener this
// replaced, which tested only for the search box itself; the note field's `/` is taken, `true` where
// `false` is due.
test('a / typed into another field is left to it', async () => {
    using _find = await mount(QuickFind({}))
    const note = document.createElement('textarea')
    document.body.append(note)
    const event = new KeyboardEvent('keydown', {
        key: '/',
        cancelable: true,
        bubbles: true,
    })
    note.dispatchEvent(event)
    note.remove()
    expect(event.defaultPrevented).toBe(false)
})
