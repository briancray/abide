import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import ContractPreview from './ContractPreview.abide'

const dialog = () => document.querySelector('dialog') as HTMLDialogElement

function click(target: Element) {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
}

// THE REVERT: leave the backdrop part's click unread, and a dialog filling the screen has nothing a
// click closes it by — its own box is the whole viewport.
test('a click beside the contract closes the preview, and a click on it does not', async () => {
    using _preview = await mount(ContractPreview({}))
    document.querySelector<HTMLButtonElement>('button')?.click()
    flushSync()
    expect(dialog().open).toBe(true)
    click(dialog().querySelector('article') as HTMLElement)
    expect(dialog().open).toBe(true)
    const backdrop = dialog().querySelector('[data-dialog=backdrop]')
    click(backdrop as HTMLElement)
    expect(dialog().open).toBe(false)
    expect(dialog().hasAttribute('data-open')).toBe(false)
})
