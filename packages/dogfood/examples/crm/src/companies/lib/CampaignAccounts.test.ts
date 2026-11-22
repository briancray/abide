import { afterEach, beforeEach, expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import CampaignAccounts from './CampaignAccounts.abide'

// A platform whose `mod` is Ctrl, so the presses below hold the key the parts read as `mod`.
beforeEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })
})
afterEach(() => {
    Reflect.deleteProperty(navigator, 'userAgent')
})

const items = () =>
    [...document.querySelectorAll('[role=treeitem]')] as HTMLElement[]
const named = (name: string) =>
    items().find(
        (item) => item.firstChild?.textContent?.trim() === name,
    ) as HTMLElement
const picked = () => document.querySelector('.status')?.textContent
function click(name: string, init: MouseEventInit = {}) {
    named(name).dispatchEvent(
        new MouseEvent('click', { bubbles: true, ...init }),
    )
    flushSync()
}
function press(key: string, init: KeyboardEventInit = {}) {
    ;(document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
            ...init,
        }),
    )
    flushSync()
}

// 51.105, 51.106, 51.107 — A CLICK PICKS ONE, `mod` ADDS OR TAKES OUT, Shift TAKES THE RUN from the
// last item picked to it, in the order the items show. THE REVERT: toggle on Shift as on `mod`, and
// Shift on Turing Labs adds it alone rather than the run from Babbage & Co.
test('a click picks one account, mod adds another, and Shift takes the run between', async () => {
    using _tree = await mount(CampaignAccounts({}))
    expect(
        document
            .querySelector('[role=tree]')
            ?.getAttribute('aria-multiselectable'),
    ).toBe('true')
    click('Hopper & Co')
    expect(picked()).toBe('hopper')
    click('Europe', { ctrlKey: true })
    expect(picked()).toBe('hopper, europe')
    click('Babbage & Co')
    expect(picked()).toBe('babbage')
    click('Turing Labs', { shiftKey: true })
    expect(picked()).toBe('babbage, americas, turing')
    expect(named('Americas').getAttribute('aria-selected')).toBe('true')
    expect(named('Hopper & Co').getAttribute('aria-selected')).toBe('false')
})

// 51.108, 51.109, 51.110 — Space ADDS OR TAKES OUT the item focused, Shift with an arrow carries the
// run along, and `mod+a` takes every account. THE REVERT: drop the run from Shift with an arrow, and
// focus moves to Babbage & Co with Hopper & Co alone picked.
test('Space picks the account focused, Shift with an arrow extends, and mod+a takes all', async () => {
    using _tree = await mount(CampaignAccounts({}))
    named('Hopper & Co').focus()
    press(' ')
    expect(picked()).toBe('hopper')
    press('ArrowDown', { shiftKey: true })
    expect(picked()).toBe('hopper, babbage')
    press('ArrowDown')
    press(' ')
    expect(picked()).toBe('hopper, babbage, americas')
    press(' ')
    expect(picked()).toBe('hopper, babbage')
    press('a', { ctrlKey: true })
    expect(picked()).toBe('europe, hopper, babbage, americas, turing')
})
