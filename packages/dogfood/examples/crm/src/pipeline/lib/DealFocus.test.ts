import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealFocus from './DealFocus.abide'

const list = (label: string) =>
    document.querySelector(`[aria-label="${label}"]`) as HTMLElement
const names = (label: string) =>
    [...list(label).querySelectorAll('[role=option] span:last-child')].map(
        (name) => name.textContent,
    )
const key = (label: string, name: string, held: KeyboardEventInit = {}) => {
    list(label).dispatchEvent(
        new KeyboardEvent('keydown', { key: name, cancelable: true, ...held }),
    )
    flushSync()
}

test('Alt with ArrowLeft and ArrowRight moves a deal between this week and later', async () => {
    using _focus = await mount(DealFocus({}))
    list('Later').focus()
    key('Later', 'ArrowDown')
    key('Later', 'ArrowLeft', { altKey: true })
    expect(names('This week')).toEqual(['Engine renewal', 'Hopper expansion'])
    expect(names('Later')).toEqual(['Babbage pilot', 'Lovelace audit'])
    // Focus follows the deal, so the next press moves it again.
    expect(document.activeElement).toBe(list('This week'))
    key('This week', 'ArrowUp', { altKey: true })
    expect(names('This week')).toEqual(['Hopper expansion', 'Engine renewal'])
    key('This week', 'ArrowRight', { altKey: true })
    expect(names('Later')).toEqual([
        'Hopper expansion',
        'Babbage pilot',
        'Lovelace audit',
    ])
})
