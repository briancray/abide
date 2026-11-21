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

// 49.9 — THE SHIPPED `CommandPalette` IS `commandPalette`'S MARKUP: a `Dialog` holding the combobox
// input, the list of options and the children where nothing matches, opened on its own `hotkey`.
// THE REVERT: drop `palette.input` from `CommandPalette.abide`'s input, and it is no combobox.
test('the shipped CommandPalette opens on its key, lists what is typed and runs it', async () => {
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
        [...dialog().querySelectorAll('[role=option] [data-part=label]')].map(
            (option) => option.textContent,
        ),
    ).toEqual(['Export deals'])
    press('Enter')
    expect(dialog().open).toBe(false)
    expect(document.querySelector('.status')?.textContent).toBe('Exported.')
})
