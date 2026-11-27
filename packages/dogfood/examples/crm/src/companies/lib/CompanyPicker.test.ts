import { expect, spyOn, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount, settled } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import { searchCompanies } from '../searchCompanies.server.ts'
import CompanyPicker from './CompanyPicker.abide'

const input = () => document.querySelector('input') as HTMLInputElement
const options = () =>
    [...document.querySelectorAll('[role=option]')].map((option) => ({
        name: option.textContent,
        active: option.hasAttribute('data-active'),
    }))

async function type(text: string) {
    input().value = text
    input().dispatchEvent(new Event('input'))
    await settled()
}

function press(key: string) {
    input().dispatchEvent(
        new KeyboardEvent('keydown', { key, cancelable: true }),
    )
    flushSync()
}

test('typing searches, and Enter picks the active company — 51.15, 51.22, 51.24, 51.25, 51.26, 51.32', async () => {
    using _picker = await mount(CompanyPicker({}))
    expect(document.querySelector('[role=listbox]')).toBeNull()
    await type('ar')
    expect(options()).toEqual([
        { name: 'Hopper & Co · Arlington', active: true },
        { name: 'Langley Research · Hampton', active: false },
    ])
    press('ArrowDown')
    expect(input().getAttribute('aria-activedescendant')).toBe(
        'works-at-option-langley-research',
    )
    press('Enter')
    expect(input().value).toBe('Langley Research')
    expect(document.querySelector('[role=listbox]')).toBeNull()
    expect(document.querySelector('strong')?.textContent).toBe(
        'Langley Research',
    )
})

test('the active company stays active while the list narrows — 51.20', async () => {
    using _picker = await mount(CompanyPicker({}))
    // Both searches answered once, so the second `ar` lands inside `measure`.
    await type('ar')
    await type('a')
    press('ArrowUp')
    expect(options().map((option) => option.active)).toEqual([
        false,
        false,
        true,
    ])
    const work = measure(() => {
        input().value = 'ar'
        input().dispatchEvent(new Event('input'))
        flushSync()
    })
    expect(options()).toEqual([
        { name: 'Hopper & Co · Arlington', active: false },
        { name: 'Langley Research · Hampton', active: true },
    ])
    // Narrowing removes the row that left, and builds or rewrites none.
    atMost(work, { nodesCreated: 0, dataWrites: 0 })
})

test('Escape closes the list, and a second clears the pick', async () => {
    using _picker = await mount(CompanyPicker({}))
    await type('hop')
    press('Enter')
    expect(document.querySelector('strong')?.textContent).toBe('Hopper & Co')
    press('ArrowDown')
    expect(document.querySelector('[data-open]')).not.toBeNull()
    press('Escape')
    expect(document.querySelector('[data-open]')).toBeNull()
    press('Escape')
    expect([
        input().value,
        document.querySelector('strong')?.textContent,
    ]).toEqual(['', '—'])
})

test('a search in flight keeps the last companies listed — 51.23, 51.31', async () => {
    using _picker = await mount(CompanyPicker({}))
    await type('a')
    input().value = 'zz'
    input().dispatchEvent(new Event('input'))
    flushSync()
    expect(options()).toHaveLength(3)
    expect(document.querySelector('[data-busy]')).not.toBeNull()
    await settled()
    expect(options()).toEqual([])
    expect(
        document.querySelector('[data-combobox=empty]')?.textContent?.trim(),
    ).toBe('No company matches')
    await type('lang')
    ;(document.querySelector('[role=option]') as HTMLElement).click()
    flushSync()
    expect(document.querySelector('strong')?.textContent).toBe(
        'Langley Research',
    )
})

// 51.92 — A SEARCH OPENS ON A PRESS ONLY ONCE THERE IS TEXT TO SEARCH FOR: nothing has been searched
// for an empty field. THE REVERT: open on a press whatever the field holds — an empty list opens.
test('a press on an empty search field opens nothing, and with text lists what it finds', async () => {
    using _picker = await mount(CompanyPicker({}))
    input().click()
    flushSync()
    expect(document.querySelector('[data-open]')).toBeNull()
    await type('ar')
    press('Escape')
    expect(document.querySelector('[data-open]')).toBeNull()
    input().click()
    await settled()
    expect(options().map((option) => option.name)).toEqual([
        'Hopper & Co · Arlington',
        'Langley Research · Hampton',
    ])
})

// THE REVERT: drop `if (!open()) return NOTHING` from `combobox`'s `found`, and the picker searches
// for '' as it mounts, shut — `searches while shut: 1` where `0` is due.
test('nothing is searched while the list is shut — 51.17', async () => {
    // `searchCompanies` sleeps 150 ms once per search it answers, so its sleeps count its calls —
    // once the answers earlier tests left are dropped, since one already held is not asked again.
    searchCompanies.invalidate()
    using sleep = spyOn(Bun, 'sleep')
    const searches = () => sleep.mock.calls.filter(([ms]) => ms === 150).length
    using _picker = await mount(CompanyPicker({}))
    flushSync()
    await Bun.sleep(0)
    flushSync()
    expect(document.querySelector('[data-open]')).toBeNull()
    expect(`searches while shut: ${searches()}`).toBe('searches while shut: 0')
    await type('ar')
    expect(searches()).toBe(1)
    press('Escape')
    await Bun.sleep(0)
    flushSync()
    expect(`searches while shut: ${searches() - 1}`).toBe(
        'searches while shut: 0',
    )
})

// THE REVERT: drop the Home/End return at the top of `combobox`'s `keydown`, and End moves the active
// company to the last — `[true, false]` where the first stays active — and is prevented.
test('Home and End move the caret, never the active company — 51.21', async () => {
    using _picker = await mount(CompanyPicker({}))
    await type('ar')
    const prevented: boolean[] = []
    for (const key of ['End', 'Home']) {
        const event = new KeyboardEvent('keydown', { key, cancelable: true })
        input().dispatchEvent(event)
        flushSync()
        prevented.push(event.defaultPrevented)
        expect(options().map((option) => option.active)).toEqual([true, false])
    }
    expect(prevented).toEqual([false, false])
})
