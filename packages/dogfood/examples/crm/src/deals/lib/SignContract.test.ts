import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import SignContract from './SignContract.abide'

const dialog = () => document.querySelector('dialog') as HTMLDialogElement

// THE REVERT: drop the `dismissible` check, and Escape closes it.
test('a dialog not dismissible stays open on Escape', async () => {
    using _contract = await mount(SignContract({}))
    document.querySelector<HTMLButtonElement>('p button')?.click()
    flushSync()
    expect(dialog().open).toBe(true)
    // Escape, as a browser does it: a cancel that closes unless prevented.
    const escape = new Event('cancel', { cancelable: true })
    if (dialog().dispatchEvent(escape)) dialog().close()
    dialog().dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: -5, clientY: -5 }),
    )
    flushSync()
    expect(dialog().open).toBe(true)
    dialog().querySelector<HTMLButtonElement>('[value=sign]')?.click()
    flushSync()
    expect(dialog().open).toBe(false)
    expect(document.querySelector('strong')?.textContent).toBe('Signed')
})
