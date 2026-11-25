import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount, settled } from '@abide/harness/abide'

import DealQuickLook from './DealQuickLook.abide'

const dialog = () => document.querySelector('dialog') as HTMLDialogElement
const row = (name: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('li button')].find(
        (button) => button.textContent === name,
    ) as HTMLButtonElement

function click(button: HTMLButtonElement) {
    button.click()
    flushSync()
}

// 11.7, 11.8, 50.2 — `open` is a memo over the deal looked at: the dialog's close writes `false` to
// it, and `onclose` clears the deal so the memo recomputes. THE REVERT: drop `onclose` — the close's
// write stands, the deal is still looked at, and the same row opens nothing the second time.
test('every row opens the one dialog, and the same row opens it again after a close', async () => {
    using _look = await mount(DealQuickLook({}))
    await settled()
    flushSync()
    click(row('Hopper & Co pilot'))
    expect(dialog().open).toBe(true)
    expect(dialog().querySelector('h2')?.textContent).toBe('Hopper & Co pilot')
    click(dialog().querySelector('form button') as HTMLButtonElement)
    expect(dialog().open).toBe(false)
    click(row('Langley Research audit'))
    expect(dialog().querySelector('h2')?.textContent).toBe(
        'Langley Research audit',
    )
    click(dialog().querySelector('form button') as HTMLButtonElement)
    click(row('Langley Research audit'))
    expect(dialog().open).toBe(true)
})
