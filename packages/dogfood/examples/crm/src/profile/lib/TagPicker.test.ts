import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount, settled } from '@abide/harness/abide'

import TagPicker from './TagPicker.abide'

const input = () => document.querySelector('input') as HTMLInputElement
const chips = () =>
    [...document.querySelectorAll('[data-combobox=chip]')].map((chip) =>
        chip.firstChild?.textContent?.trim(),
    )
const options = () =>
    [...document.querySelectorAll('[role=option]')].map((option) =>
        option.textContent?.trim(),
    )

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

// THE REVERT: drop `create`, and Enter on "Board" picks nothing.
test('a tag nobody has written yet is listed last, and Enter adds it', async () => {
    using _picker = await mount(TagPicker({}))
    await settled()
    type('m')
    expect(options()).toEqual(['mentor', 'Add “m”'])
    type('Board')
    expect(options()).toEqual(['Add “board”'])
    press('Enter')
    expect(chips()).toEqual(['investor', 'board'])
    expect(input().value).toBe('')
    // A tag the picker holds already is never offered again.
    type('BOARD')
    expect(options()).toEqual([])
})

// THE REVERT: clear the typed text before `value.set` rather than after it settles, and the
// refused "advisor" is wiped from the field.
test('a fourth tag the gate refuses leaves the tags, the field and the list as they stood', async () => {
    using _picker = await mount(TagPicker({}))
    await settled()
    type('speaker')
    press('Enter')
    type('mentor')
    press('Enter')
    expect(chips()).toEqual(['investor', 'speaker', 'mentor'])
    type('advisor')
    press('Enter')
    expect(chips()).toEqual(['investor', 'speaker', 'mentor'])
    expect(input().value).toBe('advisor')
    expect(options()).toEqual(['advisor'])
    expect(document.querySelector('.status')?.textContent).toBe('3 of 3 tags')
})
