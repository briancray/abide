import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount, settled } from '@abide/harness/abide'

import RenameDeal from './RenameDeal.abide'

const dialog = () => document.querySelector('dialog') as HTMLDialogElement
const input = () =>
    dialog().querySelector('[data-prompts=input]') as HTMLInputElement
const deal = () => document.querySelector('strong')?.textContent

async function ask() {
    document.querySelector<HTMLButtonElement>('p button')?.click()
    await settled()
    flushSync()
}

async function press(part: 'confirm' | 'cancel') {
    dialog().querySelector<HTMLButtonElement>(`[data-prompts=${part}]`)?.click()
    await settled()
    flushSync()
}

test('the input starts from the deal name', async () => {
    using _deal = await mount(RenameDeal({}))
    await ask()
    expect(dialog().open).toBe(true)
    expect(input().value).toBe('Engine renewal')
    expect(input().placeholder).toBe('Deal name')
    await press('cancel')
})

// THE REVERT: settle with `typed` on any close, and Cancel renames.
test('Rename takes the text typed, and Cancel keeps the old name', async () => {
    using _deal = await mount(RenameDeal({}))
    await ask()
    input().value = 'Engine renewal 2027'
    input().dispatchEvent(new Event('input', { bubbles: true }))
    await press('cancel')
    expect(deal()).toBe('Engine renewal')
    await ask()
    expect(input().value).toBe('Engine renewal')
    input().value = 'Engine renewal 2027'
    input().dispatchEvent(new Event('input', { bubbles: true }))
    await press('confirm')
    expect(deal()).toBe('Engine renewal 2027')
    expect(dialog().open).toBe(false)
})
