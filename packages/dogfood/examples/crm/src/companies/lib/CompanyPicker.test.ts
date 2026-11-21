import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount, settled } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

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

test('typing searches, and Enter picks the active company', async () => {
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

test('the active company stays active while the list narrows', async () => {
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

test('a search in flight keeps the last companies listed', async () => {
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
        document.querySelector('[data-part=empty]')?.textContent?.trim(),
    ).toBe('No company matches')
    await type('lang')
    ;(document.querySelector('[role=option]') as HTMLElement).click()
    flushSync()
    expect(document.querySelector('strong')?.textContent).toBe(
        'Langley Research',
    )
})

// 51.99 — A SEARCH OPENS ON A PRESS ONLY ONCE THERE IS TEXT TO SEARCH FOR: nothing has been searched
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
