import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'
import ContactNote from './ContactNote.abide'

const savedNote = () => document.querySelectorAll('strong')[3]?.textContent

test('a note not yet saved asks ready() like the rest', async () => {
    using _note = await mount(ContactNote({}))
    expect(savedNote()).toBe('…')
    const input = document.querySelector('input') as HTMLInputElement
    input.value = 'call back Monday'
    input.dispatchEvent(new Event('input'))
    document.querySelector('button')?.click()
    flushSync()
    expect(savedNote()).toBe('call back Monday')
})
