import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount, settled } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import ContactPicker from './ContactPicker.abide'

const input = () => document.querySelector('input') as HTMLInputElement
const names = () =>
    [...document.querySelectorAll('[role=option]')].map(
        (option) => option.textContent,
    )

function type(text: string) {
    input().value = text
    input().dispatchEvent(new Event('input'))
    flushSync()
}

test('typing narrows the contacts, ignoring case', async () => {
    using _picker = await mount(ContactPicker({}))
    await settled()
    type('ER')
    expect(names()).toEqual(['Grace Hopper', 'Katherine Johnson'])
    type('')
    expect(names()).toHaveLength(3)
    type('zz')
    expect(
        document.querySelector('[data-part=empty]')?.textContent?.trim(),
    ).toBe('No contact matches')
})

test('narrowing keeps the rows still listed, and builds none', async () => {
    using _picker = await mount(ContactPicker({}))
    await settled()
    type('o')
    const kept = document.querySelectorAll('[role=option]')[1]
    const work = measure(() => type('ho'))
    expect(document.querySelectorAll('[role=option]')[0]).toBe(kept)
    atMost(work, { nodesCreated: 0 })
})

test('Enter picks the active contact, and the input shows it', async () => {
    using _picker = await mount(ContactPicker({}))
    await settled()
    type('ka')
    input().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
    )
    flushSync()
    expect([
        input().value,
        document.querySelector('strong')?.textContent,
    ]).toEqual(['Katherine Johnson', 'Langley Research'])
})

// THE REVERT: hand every Escape to the list, and the third one is prevented, so a `<dialog>`
// holding the picker never cancels.
test('Escape shuts, then clears, then is left to the page', async () => {
    using _picker = await mount(ContactPicker({}))
    await settled()
    type('ka')
    const escape = () => {
        const event = new KeyboardEvent('keydown', {
            key: 'Escape',
            cancelable: true,
            bubbles: true,
        })
        input().dispatchEvent(event)
        flushSync()
        return event.defaultPrevented
    }
    expect(escape()).toBe(true)
    expect(document.querySelector('[role=listbox]')).toBeNull()
    expect(escape()).toBe(true)
    expect(input().value).toBe('')
    expect(escape()).toBe(false)
})
