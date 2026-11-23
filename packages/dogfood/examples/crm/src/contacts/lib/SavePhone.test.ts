import { expect, test } from 'bun:test'

import { flushSync, toasts } from '@abide/abide'
import { measure, mount, settled } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import Toasts from '#src/lib/Toasts.abide'

import SavePhone from './SavePhone.abide'

const notices = () =>
    [...document.querySelectorAll('[data-toasts=toast]')].map((toast) => [
        toast.getAttribute('data-tone'),
        toast.querySelector('[data-toasts=text]')?.textContent,
        toast.querySelector('[data-toasts=action]')?.textContent ?? null,
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
            .querySelector('[data-toasts=toast]')
            ?.parentElement?.getAttribute('role'),
    ).toBe('status')
    expect(notices()).toEqual([['success', 'Phone saved', null]])
    await save('12')
    expect(notices()).toEqual([
        ['success', 'Phone saved', null],
        ['error', 'A phone number needs at least seven digits.', 'Report'],
    ])
    for (const close of document.querySelectorAll<HTMLButtonElement>(
        '[data-toasts=close]',
    ))
        close.click()
    flushSync()
})

// Each notice is its own row, so closing one touches no other.
test('closing one notice leaves the others where they are', async () => {
    using _phone = await mount(SavePhone({}))
    await save('555 0100')
    await save('12')
    const [first] = document.querySelectorAll<HTMLButtonElement>(
        '[data-toasts=close]',
    )
    const work = measure(() => {
        first?.click()
        flushSync()
    })
    expect(notices()).toEqual([
        ['error', 'A phone number needs at least seven digits.', 'Report'],
    ])
    // The one move is the closed notice leaving.
    atMost(work, { nodesCreated: 0, elementsMoved: 1, attributesSet: 0 })
    document.querySelector<HTMLButtonElement>('[data-toasts=close]')?.click()
    flushSync()
})

// 50.41, 50.42 — A NOTICE CARRIES THE ATTRIBUTES IT WAS GIVEN, and its action tells `onclose` it was
// the action that took it. THE REVERTS: drop the `...toast.attributes` spread from `toasts.host`'s
// `toast` part — the notice carries no `data-track`; take the action through `dismiss` again —
// `dismissed` where `action` is due.
test('a notice carries its attributes, and its action tells onclose why it left', async () => {
    using _phone = await mount(SavePhone({}))
    await save('555 0100')
    expect(
        document
            .querySelector('[data-toasts=toast]')
            ?.getAttribute('data-track'),
    ).toBe('phone-saved')
    document.querySelector<HTMLButtonElement>('[data-toasts=close]')?.click()
    flushSync()

    using _toasts = await mount(Toasts({}))
    const reasons: string[] = []
    toasts.notify('Deal archived', {
        timeout: Infinity,
        action: { label: 'Undo', run: () => {} },
        onclose: (reason) => reasons.push(reason),
    })
    flushSync()
    document.querySelector<HTMLButtonElement>('[data-toasts=action]')?.click()
    flushSync()
    expect(reasons).toEqual(['action'])
})

// 50.36 — TWO `Toasts` STANDING SHOW EACH NOTICE ONCE: the last mounted renders the list, and the other
// renders none rather than a second copy read out twice. THE REVERT: have `toasts.host` hand back the
// notices whether or not it is the last standing, and the notice shows twice.
test('a notice shows once where two Toasts stand', async () => {
    using _contact = await mount(SavePhone({}))
    using _second = await mount(Toasts({}))
    const id = toasts.notify('Saved')
    flushSync()
    expect(notices()).toEqual([['info', 'Saved', null]])
    toasts.dismiss(id)
    flushSync()
})
