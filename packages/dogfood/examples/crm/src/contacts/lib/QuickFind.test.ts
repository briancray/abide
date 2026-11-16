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
