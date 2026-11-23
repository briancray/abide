import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealPriorities from './DealPriorities.abide'

const names = () =>
    [...document.querySelectorAll('li span')].map((name) => name.textContent)
const key = (name: string) => {
    document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', {
            key: name,
            bubbles: true,
            cancelable: true,
        }),
    )
    flushSync()
}

test('the priorities move with the keys, and Escape puts them back', async () => {
    using _ranks = await mount(DealPriorities({}))
    ;(
        document.querySelector(
            '[aria-label="Move Engine renewal"]',
        ) as HTMLElement
    ).focus()
    key(' ')
    key('ArrowDown')
    key('ArrowDown')
    expect(names()).toEqual([
        'Babbage pilot',
        'Hopper expansion',
        'Engine renewal',
    ])
    await Bun.sleep(0)
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
        'Move Engine renewal',
    )
    key('Escape')
    expect(names()).toEqual([
        'Engine renewal',
        'Babbage pilot',
        'Hopper expansion',
    ])
    // Focus comes back to the handle once its item has moved back.
    await Bun.sleep(0)
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
        'Move Engine renewal',
    )
    key('Enter')
    key('ArrowDown')
    key('Enter')
    expect(names()).toEqual([
        'Babbage pilot',
        'Engine renewal',
        'Hopper expansion',
    ])
})
