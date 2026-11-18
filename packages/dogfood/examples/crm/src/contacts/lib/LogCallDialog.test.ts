import { expect, test } from 'bun:test'

import { flushSync, reactive } from '@abide/abide'
import Dialog from '@abide/abide/Dialog.abide'
import { mount } from '@abide/harness/abide'

import LogCallDialog from './LogCallDialog.abide'

const dialog = () => document.querySelector('dialog') as HTMLDialogElement
const calls = () =>
    [...document.querySelectorAll('li strong')].map((call) => call.textContent)

function open() {
    document.querySelector<HTMLButtonElement>('button')?.click()
    flushSync()
}

function type(note: string) {
    const field = dialog().querySelector('textarea') as HTMLTextAreaElement
    field.value = note
    field.dispatchEvent(new Event('input', { bubbles: true }))
}

test('Log call keeps the note, and Cancel drops it', async () => {
    using _log = await mount(LogCallDialog({}))
    open()
    expect(dialog().open).toBe(true)
    expect(dialog().hasAttribute('data-open')).toBe(true)
    type('Asked for the engine quote')
    dialog().querySelector<HTMLButtonElement>('[value=cancel]')?.click()
    flushSync()
    expect(dialog().open).toBe(false)
    expect(dialog().hasAttribute('data-open')).toBe(false)
    expect(calls()).toEqual([])
    open()
    type('Asked for the engine quote')
    dialog().querySelector<HTMLButtonElement>('[value=log]')?.click()
    flushSync()
    expect(calls()).toEqual(['Asked for the engine quote'])
})

test('Escape closes it, and a click on the backdrop does too', async () => {
    using _log = await mount(LogCallDialog({}))
    open()
    // Escape, as a browser does it: a cancel that closes unless prevented.
    const escape = new Event('cancel', { cancelable: true })
    if (dialog().dispatchEvent(escape)) dialog().close()
    flushSync()
    expect(dialog().hasAttribute('data-open')).toBe(false)
    open()
    dialog().dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: -5, clientY: -5 }),
    )
    flushSync()
    expect(dialog().open).toBe(false)
    // Reopened, so the button that opens it still works after a dismissal.
    open()
    expect(dialog().open).toBe(true)
})

// THE REVERT: drop the `dismissible` check, and Escape closes it.
test('a dialog not dismissible stays open on Escape', async () => {
    const open = reactive(true)
    using _dialog = await mount(Dialog({ open, dismissible: false }))
    flushSync()
    expect(dialog().open).toBe(true)
    const escape = new Event('cancel', { cancelable: true })
    if (dialog().dispatchEvent(escape)) dialog().close()
    dialog().dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: -5, clientY: -5 }),
    )
    flushSync()
    expect(dialog().open).toBe(true)
    open.set(false)
    flushSync()
    expect(dialog().open).toBe(false)
})
