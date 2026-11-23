import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealPriorities from './DealPriorities.abide'

const list = () => document.querySelector('[role=listbox]') as HTMLElement
const names = () =>
    [...document.querySelectorAll('[role=option] span:last-child')].map(
        (name) => name.textContent,
    )
const key = (name: string, held: KeyboardEventInit = {}) => {
    list().dispatchEvent(
        new KeyboardEvent('keydown', { key: name, cancelable: true, ...held }),
    )
    flushSync()
}

test('the deals selected move together with Alt and the arrows', async () => {
    using _ranks = await mount(DealPriorities({}))
    list().focus()
    // Shift with the arrows selects a run, as in any listbox.
    key('ArrowDown', { shiftKey: true })
    expect([...document.querySelectorAll('[aria-selected=true]')].length).toBe(
        2,
    )
    key('ArrowDown', { altKey: true })
    key('ArrowDown', { altKey: true })
    expect(names()).toEqual([
        'Hopper expansion',
        'Lovelace audit',
        'Engine renewal',
        'Babbage pilot',
    ])
    // A deal outside the selection moves alone.
    key('Home')
    key('ArrowDown', { altKey: true })
    expect(names()).toEqual([
        'Lovelace audit',
        'Hopper expansion',
        'Engine renewal',
        'Babbage pilot',
    ])
})
