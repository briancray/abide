import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealAttachments from './DealAttachments.abide'

const listed = () =>
    [...document.querySelectorAll('li')].map((file) => file.textContent)
const status = () => document.querySelector('.status')?.textContent

/** Drops `names` on the deal as PDFs, as a drag from the desktop would. */
function dropped(...names: string[]) {
    const files = names.map(
        (name) => new File(['%PDF'], name, { type: 'application/pdf' }),
    )
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', {
        value: { types: ['Files'], files, items: [] },
    })
    document.querySelector('label')?.dispatchEvent(drop)
    flushSync()
}

// 53.56 — A DROP REPLACES `files`, so the deal keeps every batch by appending it in `onfiles`.
// THE REVERT: list `drop.files()` instead, and the second drop hides the first.
test('each drop is appended to the papers the deal already holds', async () => {
    using _papers = await mount(DealAttachments({}))
    dropped('contract.pdf', 'order-form.pdf')
    dropped('signed.pdf')
    expect(listed()).toEqual(['contract.pdf', 'order-form.pdf', 'signed.pdf'])
    expect(status()).toBe('1 in the last drop')
})
