import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { prompts } from '@abide/abide/Prompts.abide'
import { mount, settled } from '@abide/harness/abide'

import DeleteDeal from './DeleteDeal.abide'

const dialog = () => document.querySelector('dialog') as HTMLDialogElement
const deals = () =>
    [...document.querySelectorAll('li strong')].map((deal) => deal.textContent)

// Presses Delete on the first deal, then the dialog's button `part`.
async function answer(part: 'confirm' | 'cancel') {
    document.querySelector<HTMLButtonElement>('li button')?.click()
    await settled()
    flushSync()
    expect(dialog().open).toBe(true)
    dialog().querySelector<HTMLButtonElement>(`[data-part=${part}]`)?.click()
    await settled()
    flushSync()
}

test('a deal is deleted only once the dialog is confirmed', async () => {
    using _deals = await mount(DeleteDeal({}))
    await answer('cancel')
    expect(dialog().open).toBe(false)
    expect(deals()).toEqual(['Engine renewal', 'Compiler pilot'])
    await answer('confirm')
    expect(deals()).toEqual(['Compiler pilot'])
})

test('the question names the deal and is marked danger', async () => {
    using _deals = await mount(DeleteDeal({}))
    document.querySelector<HTMLButtonElement>('li button')?.click()
    await settled()
    flushSync()
    expect(dialog().getAttribute('role')).toBe('alertdialog')
    expect(dialog().hasAttribute('data-danger')).toBe(true)
    expect(dialog().querySelector('[data-part=title]')?.textContent).toBe(
        'Delete Engine renewal?',
    )
    dialog().querySelector<HTMLButtonElement>('[data-part=cancel]')?.click()
    await settled()
})

// THE REVERT: drop the `typedRight` check, and Delete enables at once.
test('Delete waits for the word to be typed', async () => {
    using _deals = await mount(DeleteDeal({}))
    const asked = prompts.confirm({ body: 'Delete Acme?', mustType: 'acme' })
    flushSync()
    const confirm = () =>
        dialog().querySelector('[data-part=confirm]') as HTMLButtonElement
    const input = dialog().querySelector(
        '[data-part=input]',
    ) as HTMLInputElement
    expect(confirm().disabled).toBe(true)
    input.value = ' ACME '
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(confirm().disabled).toBe(false)
    confirm().click()
    expect(await asked).toBe(true)
})

test('Escape declines the question', async () => {
    using _deals = await mount(DeleteDeal({}))
    const asked = prompts.confirm('Delete Acme?')
    flushSync()
    const escape = new Event('cancel', { cancelable: true })
    if (dialog().dispatchEvent(escape)) dialog().close()
    expect(await asked).toBe(false)
    flushSync()
    expect(dialog().open).toBe(false)
})
