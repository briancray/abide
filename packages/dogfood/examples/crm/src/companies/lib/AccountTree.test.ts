import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import AccountTree from './AccountTree.abide'

const items = () =>
    [...document.querySelectorAll('[role=treeitem]')] as HTMLElement[]
const named = (name: string) =>
    items().find(
        (item) => item.firstChild?.textContent?.trim() === name,
    ) as HTMLElement
const shown = () =>
    items()
        .filter((item) => item.closest('[role=group][hidden]') === null)
        .map((item) => item.firstChild?.textContent?.trim())
const focused = () =>
    (document.activeElement as HTMLElement)?.firstChild?.textContent?.trim()
function press(key: string) {
    ;(document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true }),
    )
    flushSync()
}

// 51.77, 51.78, 51.84 — EACH ITEM SAYS WHERE IT STANDS: its depth, its siblings and its place among
// them, and a branch whether it is open; a shut branch's children are hidden. THE REVERT: write no
// `aria-level`, and Grace reads none.
test('an item says its depth and place, and a shut branch hides its children', async () => {
    using _tree = await mount(AccountTree({}))
    expect(
        document.querySelector('[role=tree]')?.getAttribute('aria-label'),
    ).toBe('Accounts')
    expect(named('Europe').getAttribute('aria-expanded')).toBe('true')
    expect(named('Hopper & Co').getAttribute('aria-expanded')).toBe('false')
    expect(named('Grace Hopper').getAttribute('aria-level')).toBe('3')
    expect(named('Babbage & Co').getAttribute('aria-posinset')).toBe('2')
    expect(named('Babbage & Co').getAttribute('aria-setsize')).toBe('2')
    expect(named('Grace Hopper').hasAttribute('aria-expanded')).toBe(false)
    expect(shown()).toEqual([
        'Europe',
        'Hopper & Co',
        'Babbage & Co',
        'Americas',
    ])
})

// 51.79, 51.80 — ONE ITEM IS IN THE TAB ORDER, and Up and Down rove the ones that show, stopping at
// the ends. THE REVERT: rove with wrap, and Down from Americas lands on Europe.
test('Down and Up move through the items that show, and stop at the ends', async () => {
    using _tree = await mount(AccountTree({}))
    expect(items().filter((item) => item.tabIndex === 0)).toHaveLength(1)
    named('Europe').focus()
    press('ArrowDown')
    expect(focused()).toBe('Hopper & Co')
    press('ArrowDown')
    press('ArrowDown')
    expect(focused()).toBe('Americas')
    press('ArrowDown')
    expect(focused()).toBe('Americas')
    press('Home')
    expect(focused()).toBe('Europe')
})

// 51.81 — RIGHT OPENS, then enters; LEFT shuts, then climbs. THE REVERT: drop the climb, and Left on
// Grace stays on Grace.
test('Right opens a branch and enters it; Left shuts it and climbs to its parent', async () => {
    using _tree = await mount(AccountTree({}))
    named('Hopper & Co').focus()
    press('ArrowRight')
    expect(named('Hopper & Co').getAttribute('aria-expanded')).toBe('true')
    expect(focused()).toBe('Hopper & Co')
    press('ArrowRight')
    expect(focused()).toBe('Grace Hopper')
    expect(
        items()
            .filter((item) => item.tabIndex === 0)
            .map((item) => item.id),
    ).toEqual([named('Grace Hopper').id])
    press('ArrowLeft')
    expect(focused()).toBe('Hopper & Co')
    press('ArrowLeft')
    expect(named('Hopper & Co').getAttribute('aria-expanded')).toBe('false')
    press('ArrowLeft')
    expect(focused()).toBe('Europe')
})

// 51.82, 50.40 — A LETTER MOVES TO THE NEXT ITEM IT STARTS, as a menu's does: the same type-ahead.
// THE REVERT: answer `-1` from `typeahead`, and B leaves focus on Europe.
test('a letter moves to the next item whose name starts with it', async () => {
    using _tree = await mount(AccountTree({}))
    named('Europe').focus()
    press('b')
    expect(focused()).toBe('Babbage & Co')
})

// 51.83 — A CLICK OR ENTER PICKS the item it lands in, not the branches around it. THE REVERT: drop
// the check for the item clicked, and a click on Grace picks Europe, the last branch it bubbles to.
test('a click picks the item it lands in, and Enter picks the one focused', async () => {
    using _tree = await mount(AccountTree({}))
    named('Hopper & Co').focus()
    press('ArrowRight')
    named('Grace Hopper').click()
    flushSync()
    expect(document.querySelector('.status')?.textContent).toBe('grace')
    expect(named('Grace Hopper').getAttribute('aria-selected')).toBe('true')
    press('ArrowUp')
    press('Enter')
    expect(document.querySelector('.status')?.textContent).toBe('hopper')
})
