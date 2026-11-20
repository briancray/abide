import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import StaleDeals from './StaleDeals.abide'

const boxes = () =>
    [
        ...document.querySelectorAll('tbody input[type=checkbox]'),
    ] as HTMLInputElement[]
const every = () =>
    document.querySelector('thead input[type=checkbox]') as HTMLInputElement
const status = () => document.querySelector('.status')?.textContent
const marked = () =>
    [...document.querySelectorAll('tbody tr[data-selected]')].map(
        (row) => row.children[1]?.textContent,
    )
function click(box: HTMLInputElement, shiftKey = false) {
    box.checked = !box.checked
    box.dispatchEvent(new MouseEvent('click', { shiftKey, bubbles: true }))
    flushSync()
}

// 51.79, 51.80 — A CHECKBOX PER ROW, named by its first cell, picks it, and the row carries
// `data-selected`. THE REVERT: drop `data-selected` from the row, and no row reads picked.
test('a checked row is selected, and named by its deal', async () => {
    using _deals = await mount(StaleDeals({}))
    expect(boxes()[1]?.getAttribute('aria-label')).toBe('Select Turing seats')
    click(boxes()[1] as HTMLInputElement)
    expect(status()).toBe('1 selected')
    expect(marked()).toEqual(['Turing seats'])
})

// 51.81 — A SHIFT-CLICK RUNS FROM THE LAST ROW CLICKED, in the order the rows show. THE REVERT: drop
// the anchor, and a Shift-click picks only its own row.
test('a Shift-click picks every row from the last one clicked', async () => {
    using _deals = await mount(StaleDeals({}))
    click(boxes()[0] as HTMLInputElement)
    click(boxes()[2] as HTMLInputElement, true)
    expect(status()).toBe('3 selected')
    expect(marked()).toEqual([
        'Lovelace audit',
        'Turing seats',
        'Hopper renewal',
    ])
})

// 51.82 — THE HEADER'S BOX IS MIXED while some rows are picked, checked once all are, and a click
// on it picks all or none. THE REVERT: never write `indeterminate`, and some reads as none.
test('the header box is mixed for some, and picks every row or none', async () => {
    using _deals = await mount(StaleDeals({}))
    click(boxes()[0] as HTMLInputElement)
    expect(every().indeterminate).toBe(true)
    expect(every().checked).toBe(false)
    every().click()
    flushSync()
    expect(status()).toBe('4 selected')
    expect(every().checked).toBe(true)
    expect(every().indeterminate).toBe(false)
    every().click()
    flushSync()
    expect(status()).toBe('0 selected')
})

// 51.83 — A BULK ACTION reads the keys selected and writes the selection back. THE REVERT: bind
// `selected` one way, and the table never hands its pick to the page.
test('marking the selected deals lost clears the pick', async () => {
    using _deals = await mount(StaleDeals({}))
    click(boxes()[0] as HTMLInputElement)
    click(boxes()[3] as HTMLInputElement)
    ;(document.querySelector('.row button') as HTMLButtonElement).click()
    flushSync()
    expect(status()).toBe('0 selected')
    const stages = [...document.querySelectorAll('tbody tr')].map(
        (row) => row.children[2]?.textContent,
    )
    expect(stages).toEqual(['lost', 'proposal', 'proposal', 'lost'])
})
