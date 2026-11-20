import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealDrawer from './DealDrawer.abide'

const dialog = () => document.querySelector('dialog') as HTMLDialogElement
const button = (name: string) =>
    [...document.querySelectorAll('button')].find(
        (each) => each.textContent === name,
    ) as HTMLButtonElement

// 50.1, 50.2 — A DRAWER IS A `Dialog` laid out at a side by its own classes: the deal picked opens in
// it, and its Close button's `<form method="dialog">` shuts it and writes `false` back. THE REVERT: take
// the `<form method="dialog">` off the Close button, and the drawer stays open.
test("a deal's details open in a modal drawer, and Close shuts it", async () => {
    using _drawer = await mount(DealDrawer({}))
    expect(dialog().open).toBe(false)
    button('Babbage pilot').click()
    flushSync()
    expect(dialog().open).toBe(true)
    expect(dialog().hasAttribute('data-open')).toBe(true)
    expect(dialog().querySelector('h2')?.textContent).toBe('Babbage pilot')
    button('Close').click()
    flushSync()
    expect(dialog().open).toBe(false)
    expect(dialog().hasAttribute('data-open')).toBe(false)
})
