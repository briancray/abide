import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import Toasts, { toasts } from '@abide/abide/Toasts.abide'
import { measure, mount, settled } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import SavePhone from './SavePhone.abide'

const notices = () =>
    [...document.querySelectorAll('[data-part=toast]')].map((toast) => [
        toast.getAttribute('data-tone'),
        toast.querySelector('[data-part=text]')?.textContent,
        toast.querySelector('[data-part=action]')?.textContent ?? null,
    ])

async function save(phone: string) {
    const field = document.querySelector('input') as HTMLInputElement
    field.value = phone
    field.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('.row button')?.click()
    await settled()
    flushSync()
}

test('a refused save says why and offers a report', async () => {
    using _phone = await mount(SavePhone({}))
    await save('555 0100')
    // The live region a screen reader reads each notice out from.
    expect(
        document
            .querySelector('[data-part=toast]')
            ?.parentElement?.getAttribute('role'),
    ).toBe('status')
    expect(notices()).toEqual([['success', 'Phone saved', null]])
    await save('12')
    expect(notices()).toEqual([
        ['success', 'Phone saved', null],
        ['error', 'A phone number needs at least seven digits.', 'Report'],
    ])
    for (const close of document.querySelectorAll<HTMLButtonElement>(
        '[data-part=close]',
    ))
        close.click()
    flushSync()
})

// Each notice is its own row, so closing one touches no other.
test('closing one notice leaves the others where they are', async () => {
    using _phone = await mount(SavePhone({}))
    await save('555 0100')
    await save('12')
    const [first] =
        document.querySelectorAll<HTMLButtonElement>('[data-part=close]')
    const work = measure(() => {
        first?.click()
        flushSync()
    })
    expect(notices()).toEqual([
        ['error', 'A phone number needs at least seven digits.', 'Report'],
    ])
    // The one move is the closed notice leaving.
    atMost(work, { nodesCreated: 0, elementsMoved: 1, attributesSet: 0 })
    document.querySelector<HTMLButtonElement>('[data-part=close]')?.click()
    flushSync()
})

// 50.35, 50.36 — A NOTICE CARRIES THE ATTRIBUTES IT WAS GIVEN, and its action tells `onclose` it was
// the action that took it. THE REVERTS: drop the `{...toast.attributes}` spread in `Toasts` — the
// notice carries no `data-track`; take the action through `dismiss` again — `dismissed` where `action`
// is due.
test('a notice carries its attributes, and its action tells onclose why it left', async () => {
    using _phone = await mount(SavePhone({}))
    await save('555 0100')
    expect(
        document.querySelector('[data-part=toast]')?.getAttribute('data-track'),
    ).toBe('phone-saved')
    document.querySelector<HTMLButtonElement>('[data-part=close]')?.click()
    flushSync()

    using _toasts = await mount(Toasts({}))
    const reasons: string[] = []
    toasts.notify('Deal archived', {
        timeout: Infinity,
        action: { label: 'Undo', run: () => {} },
        onclose: (reason) => reasons.push(reason),
    })
    flushSync()
    document.querySelector<HTMLButtonElement>('[data-part=action]')?.click()
    flushSync()
    expect(reasons).toEqual(['action'])
})
