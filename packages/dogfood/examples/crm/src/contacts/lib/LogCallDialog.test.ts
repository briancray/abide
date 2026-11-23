import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
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

// 50.2 — A CLOSE REPORTED LATE DOES NOT SHUT A DIALOG THAT HAS OPENED AGAIN: `close` is a queued
// task, so a dialog shut in code and opened before it fires hears of a close that is already over.
// THE REVERT: write `false` on every `close` — the reopened dialog shuts under the reader.
test('a dialog opened again before its close is reported stays open', async () => {
    using _log = await mount(LogCallDialog({}))
    open()
    dialog().close()
    open()
    expect(dialog().open).toBe(true)
    dialog().dispatchEvent(new Event('close'))
    flushSync()
    expect(dialog().open).toBe(true)
    expect(dialog().hasAttribute('data-open')).toBe(true)
})
