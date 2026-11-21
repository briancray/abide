import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import StageNotices from './StageNotices.abide'

const button = (name: string) =>
    [...document.querySelectorAll('button')].find(
        (each) => each.textContent === name,
    ) as HTMLButtonElement
const notices = () =>
    [...document.querySelectorAll('ol li span')].map((each) => each.textContent)
const stage = () => document.querySelector('strong')?.textContent

// 50.17 — NOTICES ON MARKUP OF ONE'S OWN: the host's region is the `status` the notices are read out
// from, and each lands as an item of the app's list carrying its tone.
test('a notice lands as an item of the list, in a status region', async () => {
    using _notices = await mount(StageNotices({}))
    const region = document.querySelector('ol') as HTMLElement
    expect(region.getAttribute('role')).toBe('status')
    expect(region.getAttribute('aria-label')).toBe('Stage changes')
    button('Advance').click()
    flushSync()
    expect(notices()).toEqual(['Engine renewal moved to Verbal'])
    expect(document.querySelector('ol li')?.getAttribute('data-tone')).toBe(
        'success',
    )
    // The list is the page's: a notice left up would stand in the next test.
    button('Close').click()
    flushSync()
})

// 50.18 — THE ACTION PART TAKES THE NOTICE DOWN AND RUNS: Undo puts the stage back and the notice goes.
// THE REVERT: run the action without closing the notice — it stays in the list.
test('Undo puts the stage back and takes the notice down, and Close only takes it down', async () => {
    using _notices = await mount(StageNotices({}))
    button('Advance').click()
    flushSync()
    button('Undo').click()
    flushSync()
    expect(stage()).toBe('Proposal')
    expect(notices()).toEqual([])
    button('Advance').click()
    flushSync()
    button('Close').click()
    flushSync()
    expect(stage()).toBe('Verbal')
    expect(notices()).toEqual([])
})
