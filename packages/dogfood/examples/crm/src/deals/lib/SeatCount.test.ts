import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import SeatCount from './SeatCount.abide'

const field = () =>
    document.querySelector('[role=spinbutton]') as HTMLInputElement
const status = () => document.querySelector('.status')?.textContent
const key = (name: string) => {
    field().dispatchEvent(
        new KeyboardEvent('keydown', { key: name, cancelable: true }),
    )
    flushSync()
}

test('the seats step with the keys and the buttons, kept to the plan', async () => {
    using _seats = await mount(SeatCount({}))
    key('ArrowUp')
    expect(status()).toBe('15 seats, $18,000')
    key('PageUp')
    expect(field().getAttribute('aria-valuenow')).toBe('65')
    ;(
        document.querySelector(
            '[data-spinbutton=decrement]',
        ) as HTMLButtonElement
    ).click()
    flushSync()
    expect(status()).toBe('60 seats, $72,000')
    field().value = '73'
    field().dispatchEvent(new Event('change'))
    flushSync()
    expect([field().value, status()]).toEqual(['75', '75 seats, $90,000'])
    key('Home')
    expect(
        (
            document.querySelector(
                '[data-spinbutton=decrement]',
            ) as HTMLButtonElement
        ).disabled,
    ).toBe(true)
})

// 32.113 — A FIELD TYPED IN STILL SHOWS WHAT THE ARROWS SET. The value is the spinbutton's, spread onto
// the input, and an input the reader has typed in no longer shows its `value` attribute. THE
// REVERT: make `writeControl` return at once, and the field keeps reading 20 at 25 seats.
test('the field follows the arrows after it is typed in', async () => {
    using _seats = await mount(SeatCount({}))
    field().value = '20'
    field().dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(status()).toBe('20 seats, $24,000')
    key('ArrowUp')
    expect([field().value, status()]).toEqual(['25', '25 seats, $30,000'])
})
