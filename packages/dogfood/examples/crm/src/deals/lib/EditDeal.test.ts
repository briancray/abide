import { afterEach, expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import { DEALS } from '../../pipeline/lib/DEALS.server.ts'
import EditDeal from './EditDeal.abide'

const OPENED = { ...(DEALS[0] as (typeof DEALS)[number]) }
afterEach(() => Object.assign(DEALS[0] as object, OPENED))

const field = (name: string) =>
    document.querySelector(`input[name=${name}]`) as HTMLInputElement
const status = () => document.querySelector('.status')?.textContent
const button = (label: string) =>
    [...document.querySelectorAll('button')].find(
        (each) => each.textContent === label,
    ) as HTMLButtonElement
const typed = (name: string, value: string) => {
    field(name).value = value
    field(name).dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

// 56.14, 56.16, 56.21 — AN EDIT READS UNSAVED AGAINST THE DEAL AS IT OPENED: the amount typed carries
// `data-changed` and the company left alone does not. THE REVERT: compare each field against blank —
// every field the deal filled in reads changed before anything is typed.
test('an edit marks the field it changed and the deal unsaved', async () => {
    using _edit = await mount(EditDeal({}))
    await Bun.sleep(400)
    flushSync()
    expect(status()).toBe('Saved')
    typed('amount', '15000')
    expect(status()).toBe('Unsaved changes')
    expect(field('amount').hasAttribute('data-changed')).toBe(true)
    expect(field('company').hasAttribute('data-changed')).toBe(false)
})

// 56.18, 56.22 — UNDO PUTS THE DEAL BACK AS IT OPENED, and is disabled while there is nothing to undo.
// THE REVERT: drop `onreset` from the form's part — the deal still reads unsaved after the undo.
test('undo puts the deal back as it opened', async () => {
    using _edit = await mount(EditDeal({}))
    await Bun.sleep(400)
    flushSync()
    expect(button('Undo').disabled).toBe(true)
    typed('company', 'Babbage Ltd')
    button('Undo').click()
    flushSync()
    expect(field('company').value).toBe('Analytical Engines')
    expect(status()).toBe('Saved')
    expect(button('Undo').disabled).toBe(true)
})

// 56.19 — WHAT WAS SAVED IS WHAT AN UNDO GOES BACK TO. THE REVERT: drop the watch over the call — the
// deal reads unsaved after the save.
test('a save makes what was saved the deal an undo goes back to', async () => {
    using _edit = await mount(EditDeal({}))
    await Bun.sleep(400)
    flushSync()
    typed('amount', '15000')
    button('Save').click()
    await Bun.sleep(50)
    flushSync()
    expect(DEALS[0]?.amount).toBe(15000)
    expect(status()).toBe('Saved')
    typed('amount', '9000')
    button('Undo').click()
    flushSync()
    expect(field('amount').value).toBe('15000')
})
