import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'

import ContactRename from './ContactRename.abide'

function press(label: string): void {
    for (const button of document.querySelectorAll('button'))
        if (button.textContent === label) button.click()
    flushSync()
}

test('the draft starts over with the next contact, in place', async () => {
    using _rename = await mount(ContactRename({}))
    const input = document.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('Grace Hopper')
    input.value = 'Grace B. Hopper'
    input.dispatchEvent(new Event('input'))
    flushSync()
    expect(input.value).toBe('Grace B. Hopper')
    const work = measure(() => press('Ada Lovelace'))
    expect(document.querySelector('input')).toBe(input)
    expect(input.value).toBe('Ada Lovelace')
    // The field is the one it was: nothing made, nothing moved.
    expect(work.nodesCreated).toBe(0)
    expect(work.elementsMoved).toBe(0)
})
