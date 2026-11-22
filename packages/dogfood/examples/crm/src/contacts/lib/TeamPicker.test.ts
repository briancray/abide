import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount, settled } from '@abide/harness/abide'

import TeamPicker from './TeamPicker.abide'

const input = () => document.querySelector('input') as HTMLInputElement
const chips = () =>
    [...document.querySelectorAll('[data-combobox=chip]')].map(
        (chip) => chip.firstChild?.textContent,
    )
const status = () => document.querySelector('.status')?.textContent

function type(text: string) {
    input().value = text
    input().dispatchEvent(new Event('input'))
    flushSync()
}

function press(key: string) {
    input().dispatchEvent(
        new KeyboardEvent('keydown', { key, cancelable: true }),
    )
    flushSync()
}

function option(name: string) {
    return [...document.querySelectorAll<HTMLElement>('[role=option]')].find(
        (each) => each.firstElementChild?.textContent === name,
    ) as HTMLElement
}

// THE REVERT: read `value` as one item, and the second pick replaces the first.
test('picking adds a contact, picking it again takes it out, and the list stays open', async () => {
    using _picker = await mount(TeamPicker({}))
    await settled()
    type('a')
    option('Ada Lovelace').click()
    flushSync()
    expect(chips()).toEqual(['Ada Lovelace'])
    // The list stays open, the typed text is cleared, and the pick is marked.
    expect(document.querySelector('[role=listbox]')).not.toBeNull()
    expect(input().value).toBe('')
    expect(option('Ada Lovelace').hasAttribute('data-selected')).toBe(true)
    option('Grace Hopper').click()
    flushSync()
    expect(chips()).toEqual(['Ada Lovelace', 'Grace Hopper'])
    expect(status()).toBe('2 on the deal')
    option('Ada Lovelace').click()
    flushSync()
    expect(chips()).toEqual(['Grace Hopper'])
})

test('Backspace in an empty input takes out the last contact, and a chip takes out its own', async () => {
    using _picker = await mount(TeamPicker({}))
    await settled()
    type('a')
    option('Ada Lovelace').click()
    option('Grace Hopper').click()
    option('Katherine Johnson').click()
    flushSync()
    press('Backspace')
    expect(chips()).toEqual(['Ada Lovelace', 'Grace Hopper'])
    ;(
        document.querySelector(
            '[aria-label="Remove Ada Lovelace"]',
        ) as HTMLButtonElement
    ).click()
    flushSync()
    expect(chips()).toEqual(['Grace Hopper'])
    expect(status()).toBe('1 on the deal')
})
