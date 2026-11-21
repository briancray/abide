import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount, settled } from '@abide/harness/abide'

import ArchiveDeal from './ArchiveDeal.abide'

const dialog = () => document.querySelector('dialog') as HTMLDialogElement
const button = (name: string) =>
    [...document.querySelectorAll('button')].find(
        (each) => each.textContent === name,
    ) as HTMLButtonElement

async function ask() {
    button('Archive').click()
    await settled()
    flushSync()
}

// 50.6 — A PROMPT ON MARKUP OF ONE'S OWN: the host's parts make the app's `<dialog>` the alertdialog
// the queue's first prompt shows in, named by its title and marked danger.
test('the question shows in a dialog of its own markup, named and marked danger', async () => {
    using _archive = await mount(ArchiveDeal({}))
    await ask()
    expect(dialog().open).toBe(true)
    expect(dialog().getAttribute('role')).toBe('alertdialog')
    expect(dialog().getAttribute('aria-label')).toBe('Archive Engine renewal?')
    expect(dialog().hasAttribute('data-danger')).toBe(true)
    expect(dialog().querySelector('header')?.textContent).toBe(
        'Archive Engine renewal?',
    )
    // The queue is the page's: a prompt left unanswered would stand in the next test.
    button('Cancel').click()
    await settled()
    flushSync()
})

// 50.10 — THE CONFIRM PART WAITS FOR THE WORD: disabled until `archive` is typed, and confirming then
// archives. THE REVERT: answer `disabled` as `busy()` alone — the button is live before the word.
test('Archive stays disabled until the word is typed, and then archives', async () => {
    using _archive = await mount(ArchiveDeal({}))
    await ask()
    const confirm = dialog().querySelector('footer button') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    const input = dialog().querySelector('input') as HTMLInputElement
    input.value = ' ARCHIVE '
    input.dispatchEvent(new Event('input'))
    flushSync()
    expect(confirm.disabled).toBe(false)
    confirm.click()
    await settled()
    flushSync()
    expect(dialog().open).toBe(false)
    expect(document.querySelector('strong')?.textContent).toBe('Archived')
})
