import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealCommands from './DealCommands.abide'

const dialog = () => document.querySelector('dialog') as HTMLDialogElement
const input = () => dialog().querySelector('input') as HTMLInputElement

function press(key: string, init: KeyboardEventInit = {}) {
    ;(document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
            ...init,
        }),
    )
    flushSync()
}

// `commandPalette`'S PARTS on the CRM's own `<dialog>`: the combobox input, the list of options and
// what shows where nothing matches, opened on its own `hotkey`.
// THE REVERT: drop `palette.input` from `DealCommands.abide`'s input, and it is no combobox.
test('the palette opens on its key, lists what is typed and runs it', async () => {
    using _commands = await mount(DealCommands({}))
    press('j', { ctrlKey: true })
    await Promise.resolve()
    expect(dialog().open).toBe(true)
    expect(dialog().getAttribute('aria-label')).toBe('Deal commands')
    expect(input().getAttribute('role')).toBe('combobox')
    input().value = 'csv'
    input().dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(
        [
            ...dialog().querySelectorAll(
                '[role=option] [data-command-palette=label]',
            ),
        ].map((option) => option.textContent),
    ).toEqual(['Export deals'])
    press('Enter')
    expect(dialog().open).toBe(false)
    expect(document.querySelector('.status')?.textContent).toBe('Exported.')
})

// 51.71 — OPENED AGAIN, THE INPUT IS EMPTIED and every command is listed, the text typed last time
// included: the query is spread onto the input as its `value`, kept written into the property a
// typed-in field shows (32.113). THE REVERT: make `writeControl` return at once, and the field
// still reads `csv` over the whole list.
test('the palette opens again empty', async () => {
    using _commands = await mount(DealCommands({}))
    press('j', { ctrlKey: true })
    await Promise.resolve()
    input().value = 'csv'
    input().dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    press('j', { ctrlKey: true })
    await Promise.resolve()
    expect(dialog().open).toBe(false)
    press('j', { ctrlKey: true })
    await Promise.resolve()
    flushSync()
    expect(dialog().open).toBe(true)
    expect(input().value).toBe('')
    expect(dialog().querySelectorAll('[role=option]').length).toBe(3)
})
